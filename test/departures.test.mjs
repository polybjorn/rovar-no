// node --test. Covers src/scripts/departures-core.js: the Oslo time handling,
// Entur's fallback chains and the booking detection order. The suite runs
// twice, the second time under a foreign TZ (see the test script), because the
// failure mode these guard against is a board that is correct in Norway and an
// hour or a day wrong for a visitor abroad.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  toOsloDate,
  osloOffset,
  osloMidnight,
  osloMinutes,
  dateAtOffset,
  filterRoute,
  parseViaFromFrontText,
  getArrivalFromPassingTimes,
  getRouteInfo,
  bookingDeadline,
  bookingPattern,
  situationTexts,
  noticeState,
  timeline,
  formatCountdown,
  urgencyClass,
  kolumbusUrl,
  monthIndex,
  offsetOf,
  monthDays,
  monthNav,
  shiftMonth,
  weekdayNames,
  MAX_DAY_OFFSET,
  osloClock,
  icsTime,
  icsEscape,
  foldLine,
  journeyKey,
  departureEvent,
  icsEvent,
  icsCalendar,
  ICS_PRODID,
  FEED_TTL_MINUTES,
  groupByOsloDate,
  feedEvents,
} from '../src/scripts/departures-core.js';

// A summer and a winter instant, chosen so the UTC date and the Oslo date
// differ for the late-evening one.
const SUMMER_NOON = new Date('2026-07-15T10:00:00Z');
const WINTER_LATE = new Date('2026-01-15T23:30:00Z');

// --- time -------------------------------------------------------------------

test('osloOffset follows Norwegian DST, not the visitor', () => {
  assert.equal(osloOffset('2026-01-15'), '+01:00');
  assert.equal(osloOffset('2026-07-15'), '+02:00');
});

test('toOsloDate reports the Oslo calendar day', () => {
  assert.equal(toOsloDate(SUMMER_NOON), '2026-07-15');
  // 23:30 UTC is already the 16th in Oslo.
  assert.equal(toOsloDate(WINTER_LATE), '2026-01-16');
});

test('osloMidnight anchors the query to Oslo, whatever the browser thinks', () => {
  assert.equal(osloMidnight(0, SUMMER_NOON), '2026-07-15T00:00:00+02:00');
  assert.equal(osloMidnight(0, WINTER_LATE), '2026-01-16T00:00:00+01:00');
});

test('osloMidnight walks whole days forward', () => {
  assert.equal(osloMidnight(1, SUMMER_NOON), '2026-07-16T00:00:00+02:00');
  assert.equal(osloMidnight(MAX_DAY_OFFSET, SUMMER_NOON), '2026-07-22T00:00:00+02:00');
});

test('osloMidnight crosses the DST boundary correctly', () => {
  // Norway moves to summer time on 2026-03-29.
  const before = new Date('2026-03-27T12:00:00Z');
  assert.equal(osloMidnight(0, before), '2026-03-27T00:00:00+01:00');
  assert.equal(osloMidnight(3, before), '2026-03-30T00:00:00+02:00');
});

test('osloMinutes counts from Oslo midnight', () => {
  assert.equal(osloMinutes(new Date('2026-07-15T10:00:00Z')), 12 * 60);
  assert.equal(osloMinutes(new Date('2026-01-15T10:35:00Z')), 11 * 60 + 35);
});

test('dateAtOffset does not mutate the date it is given', () => {
  const now = new Date(SUMMER_NOON);
  dateAtOffset(3, now);
  assert.equal(now.getTime(), SUMMER_NOON.getTime());
});

// --- route data -------------------------------------------------------------

const call = ({ time, frontText = 'Haugesund', stops, passingTimes, notices, situations, id }) => ({
  expectedDepartureTime: time,
  destinationDisplay: { frontText },
  serviceJourney: {
    id,
    line: { publicCode: '700' },
    notices,
    situations,
    passingTimes,
    estimatedCalls: stops,
  },
});

test('filterRoute keeps the direction and the selected day only', () => {
  const calls = [
    call({ time: '2026-07-15T08:00:00+02:00', frontText: 'Haugesund' }),
    call({ time: '2026-07-15T09:00:00+02:00', frontText: 'Røvær' }),
    call({ time: '2026-07-16T08:00:00+02:00', frontText: 'Haugesund' }),
  ];
  assert.deepEqual(
    filterRoute(calls, 'to-haugesund', '2026-07-15').map((c) => c.expectedDepartureTime),
    ['2026-07-15T08:00:00+02:00']
  );
  assert.equal(filterRoute(calls, 'to-rovar', '2026-07-15').length, 1);
  assert.equal(filterRoute(calls, 'to-haugesund', '2026-07-16').length, 1);
});

test('filterRoute matches the destination case-insensitively', () => {
  const calls = [call({ time: '2026-07-15T08:00:00+02:00', frontText: 'HAUGESUND via Feøy' })];
  assert.equal(filterRoute(calls, 'to-haugesund', '2026-07-15').length, 1);
});

test('parseViaFromFrontText splits on dashes and commas', () => {
  assert.deepEqual(parseViaFromFrontText('Haugesund via Kveitevik - Feøy'), ['Kveitevik', 'Feøy']);
  assert.deepEqual(parseViaFromFrontText('Haugesund via Feøy, Kveitevik'), ['Feøy', 'Kveitevik']);
  assert.deepEqual(parseViaFromFrontText('Haugesund'), []);
});

test('getRouteInfo uses the per-stop calls when Entur supplies them', () => {
  const c = call({
    time: '2026-07-15T08:00:00+02:00',
    stops: [
      {
        quay: { stopPlace: { name: 'Røvær hurtigbåtkai' } },
        expectedDepartureTime: '2026-07-15T08:00:00+02:00',
        bookingArrangements: null,
      },
      {
        quay: { stopPlace: { name: 'Feøy hurtigbåtkai' } },
        expectedDepartureTime: '2026-07-15T08:10:00+02:00',
      },
      {
        quay: { stopPlace: { name: 'Haugesund hurtigbåtkai' } },
        expectedDepartureTime: '2026-07-15T08:25:00+02:00',
      },
    ],
  });
  const info = getRouteInfo(c);
  assert.equal(info.duration, 25);
  assert.deepEqual(info.via, ['Feøy']);
  assert.equal(info.hasBooking, false);
  assert.equal(info.arrivalTime.toISOString(), new Date('2026-07-15T08:25:00+02:00').toISOString());
});

test('getRouteInfo reads booking arrangements off the first stop', () => {
  const c = call({
    time: '2026-07-15T08:00:00+02:00',
    stops: [
      {
        quay: { stopPlace: { name: 'Røvær hurtigbåtkai' } },
        expectedDepartureTime: '2026-07-15T08:00:00+02:00',
        bookingArrangements: { latestBookingTime: '20:00', bookingMethods: ['callDriver'] },
      },
      {
        quay: { stopPlace: { name: 'Haugesund hurtigbåtkai' } },
        expectedDepartureTime: '2026-07-15T08:25:00+02:00',
      },
    ],
  });
  assert.equal(getRouteInfo(c).hasBooking, true);
});

test('getRouteInfo falls back to passingTimes when the stop list is empty', () => {
  // This is every future date, and 12:40 Haugesund -> Røvær even today.
  const c = call({
    time: '2026-07-20T12:40:00+02:00',
    frontText: 'Røvær via Feøy',
    stops: [],
    passingTimes: [
      { departure: { time: '12:40:00' }, arrival: { time: '12:40:00' } },
      { departure: { time: '13:05:00' }, arrival: { time: '13:05:00' } },
    ],
  });
  const info = getRouteInfo(c);
  assert.equal(info.duration, 25);
  assert.deepEqual(info.via, ['Feøy']);
  assert.equal(info.hasBooking, false, 'booking data is not available ahead of today');
  assert.equal(toOsloDate(info.arrivalTime), '2026-07-20');
});

test('passingTimes are read as Oslo wall-clock, not as the visitor local time', () => {
  const c = call({
    time: '2026-07-20T12:40:00+02:00',
    stops: [],
    passingTimes: [
      { departure: { time: '12:40:00' }, arrival: { time: '12:40:00' } },
      { departure: { time: '13:05:00' }, arrival: { time: '13:05:00' } },
    ],
  });
  const { arrivalTime } = getRouteInfo(c);
  // 13:05 in Oslo on a summer date is 11:05 UTC, wherever the test runs.
  assert.equal(arrivalTime.toISOString(), '2026-07-20T11:05:00.000Z');
});

test('a missing arrival time falls back to the departure time of the last stop', () => {
  const c = call({
    time: '2026-07-20T12:40:00+02:00',
    stops: [],
    passingTimes: [
      { departure: { time: '12:40:00' } },
      { departure: { time: '13:10:00' }, arrival: null },
    ],
  });
  assert.equal(getRouteInfo(c).duration, 30);
});

test('a single passing time yields no arrival and no duration', () => {
  const c = call({
    time: '2026-07-20T12:40:00+02:00',
    stops: [],
    passingTimes: [{ departure: { time: '12:40:00' } }],
  });
  assert.deepEqual(getArrivalFromPassingTimes(c), { arrivalTime: null, duration: null });
});

test('a zero-length trip reports no duration rather than 0 min', () => {
  const c = call({
    time: '2026-07-20T12:40:00+02:00',
    stops: [],
    passingTimes: [
      { departure: { time: '12:40:00' } },
      { departure: { time: '12:40:00' }, arrival: { time: '12:40:00' } },
    ],
  });
  assert.equal(getRouteInfo(c).duration, null);
});

// --- notices ----------------------------------------------------------------

const re = bookingPattern();

test('the booking pattern reads the Norwegian Entur sends whatever the page language', () => {
  assert.ok(re.test('Må bestilles på forhånd'));
  assert.ok(re.test('Krever forhåndsbestilling'));
  assert.ok(re.test('Krever forhandsbestilling'), 'and the same without the å');
  assert.ok(!re.test('Går ikke i skoleferien'));
});

test('an extra word with regex punctuation matches literally instead of throwing', () => {
  const withPunctuation = bookingPattern(['reserve (kreves)']);
  assert.ok(withPunctuation.test('Reserve (kreves) i forkant'));
  assert.ok(!withPunctuation.test('reserve kreves'), 'the parentheses are literal, not a group');
});

test('bookingArrangements alone marks a departure as bestillingsrute', () => {
  const state = noticeState({
    call: call({ time: '2026-07-15T08:00:00+02:00' }),
    hasBooking: true,
    isLast: false,
    bookingRe: re,
  });
  assert.equal(state.isBooking, true);
  assert.deepEqual(state.infoTexts, [], 'the marker and the legend say it; no prose on the row');
});

test('a booking notice from the API is not repeated as an info notice', () => {
  // The marker already says it and the legend gives the number, so Entur's own
  // wording would be the third telling on one row.
  const state = noticeState({
    call: call({
      time: '2026-07-15T21:05:00+02:00',
      notices: [{ text: 'Turen må bestilles innen kl 20' }],
    }),
    hasBooking: true,
    isLast: true,
    bookingRe: re,
  });
  assert.equal(state.isBooking, true);
  assert.deepEqual(state.infoTexts, []);
});

test('minimumBookingPeriod is counted back from departure, the way Kolumbus shows it', () => {
  // The 21:05 boat off Røvær: PT40M, so kolumbus.no says "før klokken 20:25".
  const at = bookingDeadline(
    { minimumBookingPeriod: 'PT40M', bookingMethods: ['online'] },
    new Date('2026-07-15T21:05:00+02:00')
  );
  assert.equal(at.toISOString(), new Date('2026-07-15T20:25:00+02:00').toISOString());
});

test('an hours-and-minutes booking period is read whole', () => {
  const at = bookingDeadline({ minimumBookingPeriod: 'PT1H30M' }, new Date('2026-07-15T21:05:00+02:00'));
  assert.equal(at.toISOString(), new Date('2026-07-15T19:35:00+02:00').toISOString());
});

test('latestBookingTime is read as Oslo time on the departure day, not the visitor timezone', () => {
  const at = bookingDeadline(
    { latestBookingTime: '20:00' },
    new Date('2026-07-15T21:05:00+02:00')
  );
  assert.equal(at.toISOString(), new Date('2026-07-15T20:00:00+02:00').toISOString());
});

test('a wall-clock deadline later than the departure is dropped rather than shown', () => {
  // Entur carries 20:00 on the 08:00 boat; a deadline after the boat has left
  // is data noise, not something to print.
  assert.equal(bookingDeadline({ latestBookingTime: '20:00' }, new Date('2026-07-15T08:00:00+02:00')), null);
});

// --- timeline ---------------------------------------------------------------

const at = (h, m = 0) => h * 60 + m;

test('a deadline row lands at its own time, not next to the boat it belongs to', () => {
  // The 21:05 boat books by 20:25, which is two departures earlier in the day.
  const rows = timeline([
    { minutes: at(17, 45) },
    { minutes: at(18, 55) },
    { minutes: at(21, 5), deadlineMinutes: at(20, 25) },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.minutes, r.type]),
    [
      [at(17, 45), 'departure'],
      [at(18, 55), 'departure'],
      [at(20, 25), 'deadline'],
      [at(21, 5), 'departure'],
    ]
  );
  assert.equal(rows[2].forIndex, 2, 'the deadline row still points at its own departure');
});

test('departures without a deadline pass through untouched', () => {
  const rows = timeline([{ minutes: at(8) }, { minutes: at(9) }]);
  assert.deepEqual(rows.map((r) => r.type), ['departure', 'departure']);
  assert.deepEqual(rows.map((r) => r.index), [0, 1]);
});

test('a deadline falling on a departure time is listed before it', () => {
  // Booking closes as another boat leaves: the deadline is the thing you can
  // still act on, so it reads first.
  const rows = timeline([
    { minutes: at(18, 55) },
    { minutes: at(21, 5), deadlineMinutes: at(18, 55) },
  ]);
  assert.deepEqual(rows.map((r) => r.type), ['deadline', 'departure', 'departure']);
});

test('several booking departures each get their own deadline row in order', () => {
  const rows = timeline([
    { minutes: at(20, 40) },
    { minutes: at(22, 25), deadlineMinutes: at(21, 45) },
    { minutes: at(23, 30), deadlineMinutes: at(22, 50) },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.minutes, r.type]),
    [
      [at(20, 40), 'departure'],
      [at(21, 45), 'deadline'],
      [at(22, 25), 'departure'],
      [at(22, 50), 'deadline'],
      [at(23, 30), 'departure'],
    ]
  );
});

test('a deadline before the first departure of the day still sorts to the top', () => {
  const rows = timeline([{ minutes: at(6), deadlineMinutes: at(5, 20) }]);
  assert.deepEqual(rows.map((r) => r.type), ['deadline', 'departure']);
});

test('no booking data at all means no deadline', () => {
  assert.equal(bookingDeadline(null, new Date('2026-07-15T21:05:00+02:00')), null);
  assert.equal(
    bookingDeadline({ bookingMethods: ['online'] }, new Date('2026-07-15T21:05:00+02:00')),
    null
  );
});

test('notice text alone marks a departure, without booking data from the API', () => {
  const state = noticeState({
    call: call({
      time: '2026-07-15T08:00:00+02:00',
      notices: [{ text: 'Turen må bestilles innen kl 20' }],
    }),
    hasBooking: false,
    isLast: false,
    bookingRe: re,
  });
  assert.equal(state.isBooking, true);
  assert.deepEqual(state.infoTexts, []);
});

test('the last departure of the direction is marked even with no booking data', () => {
  // Entur withholds bookingArrangements ahead of today, and the last boat is
  // the one that usually needs booking.
  const base = { call: call({ time: '2026-07-15T22:00:00+02:00' }), bookingRe: re };
  assert.equal(noticeState({ ...base, hasBooking: false, isLast: true }).isBooking, true);
  assert.equal(noticeState({ ...base, hasBooking: false, isLast: false }).isBooking, false);
});

test('situations and notices both reach the detail text', () => {
  const state = noticeState({
    call: call({
      time: '2026-07-15T08:00:00+02:00',
      notices: [{ text: 'Kun skoledager' }],
      situations: [{ summary: [{ value: 'Innstilt ved kuling' }] }],
    }),
    hasBooking: false,
    isLast: false,
    bookingRe: re,
  });
  assert.deepEqual(state.infoTexts, ['Kun skoledager', 'Innstilt ved kuling']);
  assert.equal(state.isBooking, false);
});

test('an empty situation summary is dropped rather than rendered blank', () => {
  assert.deepEqual(situationTexts({ situations: [{ summary: [] }, { summary: null }] }), []);
});

// --- presentation -----------------------------------------------------------

const cd = { now: 'nå', relative: 'om {{time}}', minUnit: 'min', hourUnit: 't' };

test('formatCountdown reads naturally at every scale', () => {
  assert.equal(formatCountdown(0, cd), 'nå');
  assert.equal(formatCountdown(-5, cd), 'nå');
  assert.equal(formatCountdown(12, cd), 'om 12 min');
  assert.equal(formatCountdown(59, cd), 'om 59 min');
  assert.equal(formatCountdown(60, cd), 'om 1 t');
  assert.equal(formatCountdown(95, cd), 'om 1 t 35 min');
  assert.equal(formatCountdown(120, cd), 'om 2 t');
});

test('the countdown sentence can put the duration anywhere the language wants', () => {
  const trailing = { ...cd, relative: '{{time}} igjen' };
  assert.equal(formatCountdown(12, trailing), '12 min igjen');
  assert.equal(formatCountdown(95, trailing), '1 t 35 min igjen');
});

test('urgency escalates at 30 and 10 minutes', () => {
  assert.equal(urgencyClass(31), '');
  assert.equal(urgencyClass(30), ' is-soon');
  assert.equal(urgencyClass(11), ' is-soon');
  assert.equal(urgencyClass(10), ' is-imminent');
  assert.equal(urgencyClass(0), ' is-imminent');
});

test('the Kolumbus link carries the selected date', () => {
  const url = new URL(kolumbusUrl('2026-07-15'));
  assert.equal(url.hostname, 'reise.kolumbus.no');
  assert.ok(url.searchParams.get('dateTime').startsWith('2026-07-15'));
});

// --- calendar ---------------------------------------------------------------

test('offsetOf counts whole days across a DST change', () => {
  const before = new Date('2026-03-27T12:00:00Z');
  assert.equal(offsetOf('2026-03-27', before), 0);
  assert.equal(offsetOf('2026-03-30', before), 3);
  assert.equal(offsetOf('2026-03-26', before), -1);
});

test('monthIndex orders months across a year boundary', () => {
  assert.ok(monthIndex('2026-01-01') > monthIndex('2025-12-01'));
  assert.equal(monthIndex('2026-02-01') - monthIndex('2026-01-01'), 1);
});

test('shiftMonth wraps the year in both directions', () => {
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
});

test('the month grid starts on Monday and has one cell per day', () => {
  // 2026-07-01 is a Wednesday, so two blanks lead the grid.
  const { lead, days } = monthDays('2026-07', { selected: '2026-07-15', now: SUMMER_NOON });
  assert.equal(lead, 2);
  assert.equal(days.length, 31);
  assert.equal(days[0].date, '2026-07-01');
});

test('only today through the last selectable day is usable', () => {
  const { days } = monthDays('2026-07', { selected: '2026-07-15', now: SUMMER_NOON });
  const usable = days.filter((d) => d.usable).map((d) => d.date);
  assert.equal(usable.length, MAX_DAY_OFFSET + 1);
  assert.equal(usable[0], '2026-07-15');
  assert.equal(usable.at(-1), '2026-07-22');
});

test('the grid marks today and the selected day', () => {
  const { days } = monthDays('2026-07', { selected: '2026-07-18', now: SUMMER_NOON });
  assert.deepEqual(days.filter((d) => d.isToday).map((d) => d.date), ['2026-07-15']);
  assert.deepEqual(days.filter((d) => d.isSelected).map((d) => d.date), ['2026-07-18']);
});

test('month navigation stops at this month and at the last selectable day', () => {
  // Late July: today + 7 days reaches into August, so August is reachable.
  const lateJuly = new Date('2026-07-28T10:00:00Z');
  assert.deepEqual(monthNav('2026-07', { now: lateJuly }), { canPrev: false, canNext: true });
  assert.deepEqual(monthNav('2026-08', { now: lateJuly }), { canPrev: true, canNext: false });
});

test('a window that does not reach the next month cannot page forward', () => {
  // Mid-month, today + 7 days stays inside July.
  assert.deepEqual(monthNav('2026-07', { now: SUMMER_NOON }), { canPrev: false, canNext: false });
});

test('weekday names are Monday-first', () => {
  const names = weekdayNames('en-GB');
  assert.equal(names.length, 7);
  assert.match(names[0], /^Mon/);
  assert.match(names[6], /^Sun/);
});

// --- calendar export --------------------------------------------------------

const ICS_STAMP = new Date('2026-07-14T06:00:00Z');

const bookedCall = (extra = {}) =>
  call({
    time: '2026-07-15T21:05:00+02:00',
    frontText: 'Haugesund via Feøy',
    id: 'KOL:ServiceJourney:700_1234',
    stops: [
      {
        quay: { stopPlace: { name: 'Røvær hurtigbåtkai' } },
        expectedDepartureTime: '2026-07-15T21:05:00+02:00',
        bookingArrangements: { minimumBookingPeriod: 'PT40M', bookingMethods: ['callDriver'] },
      },
      {
        quay: { stopPlace: { name: 'Feøy hurtigbåtkai' } },
        expectedDepartureTime: '2026-07-15T21:15:00+02:00',
      },
      {
        quay: { stopPlace: { name: 'Haugesund hurtigbåtkai' } },
        expectedDepartureTime: '2026-07-15T21:30:00+02:00',
      },
    ],
    ...extra,
  });

test('icsTime is UTC, so no calendar app has to resolve a wall-clock value', () => {
  assert.equal(icsTime(new Date('2026-07-15T08:00:00+02:00')), '20260715T060000Z');
  // The same instant, whatever timezone the test process runs in.
  assert.equal(icsTime(new Date('2026-01-15T08:00:00+01:00')), '20260115T070000Z');
});

test('icsEscape protects the characters that would otherwise end a value', () => {
  assert.equal(icsEscape('Feøy, Kveitevik'), 'Feøy\\, Kveitevik');
  assert.equal(icsEscape('a;b'), 'a\\;b');
  assert.equal(icsEscape('back\\slash'), 'back\\\\slash');
  assert.equal(icsEscape('two\nlines'), 'two\\nlines');
});

test('folding counts octets, not characters', () => {
  // 40 two-octet letters is 80 octets and well under 75 characters, so a
  // length-based fold would leave this line over the limit.
  const line = `SUMMARY:${'ø'.repeat(40)}`;
  const folded = foldLine(line);
  assert.ok(folded.includes('\r\n '), 'the line should have been folded');
  for (const part of folded.split('\r\n')) {
    const bytes = [...part].reduce((n, ch) => n + Buffer.byteLength(ch, 'utf8'), 0);
    assert.ok(bytes <= 75, `line of ${bytes} octets is over the limit`);
  }
});

test('folding never splits a character in half', () => {
  const folded = foldLine(`SUMMARY:${'æ'.repeat(60)}`);
  // Round-tripping through unfolding gives the original back, which it would
  // not if a two-octet letter had been cut between its bytes.
  assert.equal(folded.replaceAll('\r\n ', ''), `SUMMARY:${'æ'.repeat(60)}`);
});

test('a short line is left alone', () => {
  assert.equal(foldLine('VERSION:2.0'), 'VERSION:2.0');
});

test('the UID names the journey and its day, so a rerun updates rather than duplicates', () => {
  const uid = departureEvent(bookedCall(), { direction: 'to-haugesund', stamp: ICS_STAMP }).uid;
  assert.equal(uid, 'KOL-ServiceJourney-700_1234-2026-07-15-to-haugesund@rovar.no');
  // Built again a day later, from the same journey, the UID is unchanged.
  const again = departureEvent(bookedCall(), {
    direction: 'to-haugesund',
    stamp: new Date('2026-07-15T06:00:00Z'),
  }).uid;
  assert.equal(again, uid);
});

test('the same journey in the other direction is a different event', () => {
  const a = departureEvent(bookedCall(), { direction: 'to-haugesund', stamp: ICS_STAMP }).uid;
  const b = departureEvent(bookedCall(), { direction: 'to-rovar', stamp: ICS_STAMP }).uid;
  assert.notEqual(a, b);
});

test('a departure without a journey id still gets a stable UID', () => {
  const c = call({ time: '2026-07-15T08:00:00+02:00', stops: [] });
  const uid = departureEvent(c, { direction: 'to-haugesund', stamp: ICS_STAMP }).uid;
  assert.equal(uid, '2026-07-15-480-2026-07-15-to-haugesund@rovar.no');
  assert.equal(uid, departureEvent(c, { direction: 'to-haugesund', stamp: ICS_STAMP }).uid);
});

test('the event runs from departure to arrival', () => {
  const event = departureEvent(bookedCall(), { direction: 'to-haugesund', stamp: ICS_STAMP });
  assert.equal(icsTime(event.start), '20260715T190500Z');
  assert.equal(icsTime(event.end), '20260715T193000Z');
});

test('an unknown arrival time leaves the event without an end, never a guessed one', () => {
  const c = call({ time: '2026-07-15T08:00:00+02:00', stops: [] });
  const event = departureEvent(c, { direction: 'to-haugesund', stamp: ICS_STAMP });
  assert.equal(event.end, null);
  assert.ok(!icsEvent(event).some((line) => line.startsWith('DTEND')));
});

test('the summary and location come from the catalog, filled with the route ends', () => {
  const strings = { icsSummary: 'Rutebåten {{from}}-{{to}}', icsLocation: '{{from}} kai' };
  const out = departureEvent(bookedCall(), {
    direction: 'to-haugesund',
    stamp: ICS_STAMP,
    strings,
  });
  assert.equal(out.summary, 'Rutebåten Røvær-Haugesund');
  assert.equal(out.location, 'Røvær kai');

  const back = departureEvent(bookedCall(), { direction: 'to-rovar', stamp: ICS_STAMP, strings });
  assert.equal(back.summary, 'Rutebåten Haugesund-Røvær');
});

test('the description carries the via stops and the booking deadline', () => {
  const event = departureEvent(bookedCall(), {
    direction: 'to-haugesund',
    stamp: ICS_STAMP,
    strings: {
      icsVia: 'Via {{stops}}.',
      icsBooking: 'Bestillingsrute. Bestill innen {{deadline}}.',
    },
  });
  assert.match(event.description, /Via Feøy\./);
  // 40 minutes before 21:05, on the Oslo clock wherever the test runs.
  assert.match(event.description, /Bestill innen 20:25\./);
});

test('a booking departure with no deadline falls back to the plain booking line', () => {
  const c = call({
    time: '2026-07-15T21:05:00+02:00',
    stops: [],
    notices: [{ text: 'Bestillingsrute' }],
  });
  const event = departureEvent(c, {
    direction: 'to-haugesund',
    stamp: ICS_STAMP,
    strings: {
      icsBooking: 'Bestill innen {{deadline}}.',
      icsBookingNoDeadline: 'Bestillingsrute.',
    },
  });
  assert.equal(event.isBooking, true);
  assert.equal(event.description, 'Bestillingsrute.');
});

test('Entur notices reach the description', () => {
  const c = call({
    time: '2026-07-15T08:00:00+02:00',
    stops: [],
    situations: [{ summary: [{ value: 'Innstilt i dårlig vær' }] }],
  });
  const event = departureEvent(c, { direction: 'to-haugesund', stamp: ICS_STAMP });
  assert.match(event.description, /Innstilt i dårlig vær/);
});

test('reminders become alarms ahead of the departure', () => {
  const event = departureEvent(bookedCall(), {
    direction: 'to-haugesund',
    stamp: ICS_STAMP,
    reminders: [30],
  });
  const lines = icsEvent(event);
  assert.ok(lines.includes('TRIGGER:-PT30M'));
  assert.equal(lines.filter((l) => l === 'BEGIN:VALARM').length, 1);
});

test('no reminders means no alarm block', () => {
  const lines = icsEvent(departureEvent(bookedCall(), { stamp: ICS_STAMP }));
  assert.ok(!lines.some((l) => l === 'BEGIN:VALARM'));
});

test('the calendar wraps its events and ends with a CRLF', () => {
  const event = departureEvent(bookedCall(), {
    direction: 'to-haugesund',
    stamp: ICS_STAMP,
    strings: { icsSummary: 'Rutebåten {{from}}-{{to}}' },
  });
  const ics = icsCalendar([event]);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
  assert.ok(ics.includes(`PRODID:${ICS_PRODID}`));
  assert.equal(ics.split('\r\n').filter((l) => l === 'BEGIN:VEVENT').length, 1);
  // Every line ends CRLF, never a bare LF.
  assert.ok(!/[^\r]\n/.test(ics));
});

test('a subscription feed advertises how often to come back', () => {
  const ics = icsCalendar([], { name: 'Rutebåten', ttlMinutes: 720 });
  assert.ok(ics.includes('REFRESH-INTERVAL;VALUE=DURATION:PT720M'));
  assert.ok(ics.includes('X-PUBLISHED-TTL:PT720M'));
  assert.ok(ics.includes('X-WR-CALNAME:Rutebåten'));
});

test('a download carries METHOD:PUBLISH and a feed does not', () => {
  assert.ok(icsCalendar([], { method: 'PUBLISH' }).includes('METHOD:PUBLISH'));
  assert.ok(!icsCalendar([]).includes('METHOD:'));
});

test('osloClock prints the Oslo wall clock, not the visitor local time', () => {
  assert.equal(osloClock(new Date('2026-07-15T19:05:00Z'), 'no'), '21:05');
  assert.equal(osloClock(new Date('2026-01-15T19:05:00Z'), 'no'), '20:05');
});

// --- subscription feed ------------------------------------------------------

test('filterRoute without a date keeps the whole direction, whatever the day', () => {
  const calls = [
    call({ time: '2026-07-15T08:00:00+02:00', frontText: 'Haugesund' }),
    call({ time: '2026-07-16T08:00:00+02:00', frontText: 'Haugesund' }),
    call({ time: '2026-07-16T09:00:00+02:00', frontText: 'Røvær' }),
  ];
  assert.equal(filterRoute(calls, 'to-haugesund').length, 2);
  assert.equal(filterRoute(calls, 'to-rovar').length, 1);
});

test('a month of calls splits into Oslo days', () => {
  const calls = [
    call({ time: '2026-07-15T08:00:00+02:00' }),
    call({ time: '2026-07-15T21:05:00+02:00' }),
    call({ time: '2026-07-16T08:00:00+02:00' }),
  ];
  const days = groupByOsloDate(calls);
  assert.deepEqual(days.map((d) => d.date), ['2026-07-15', '2026-07-16']);
  assert.equal(days[0].calls.length, 2);
});

test('the day a departure belongs to is its Oslo day, not the UTC one', () => {
  // 22:30 UTC on the 15th is already 00:30 on the 16th in Oslo.
  const days = groupByOsloDate([call({ time: '2026-07-15T22:30:00Z' })]);
  assert.deepEqual(days.map((d) => d.date), ['2026-07-16']);
});

test('each day is put in clock order before the last boat is picked out', () => {
  const days = groupByOsloDate([
    call({ time: '2026-07-15T21:05:00+02:00' }),
    call({ time: '2026-07-15T08:00:00+02:00' }),
  ]);
  assert.deepEqual(
    days[0].calls.map((c) => c.expectedDepartureTime),
    ['2026-07-15T08:00:00+02:00', '2026-07-15T21:05:00+02:00']
  );
});

test('the feed merges both directions into one list in clock order', () => {
  const events = feedEvents(
    [
      {
        direction: 'to-haugesund',
        calls: [
          call({ time: '2026-07-15T08:00:00+02:00', frontText: 'Haugesund', id: 'a' }),
          call({ time: '2026-07-15T21:05:00+02:00', frontText: 'Haugesund', id: 'b' }),
        ],
      },
      {
        direction: 'to-rovar',
        calls: [call({ time: '2026-07-15T12:40:00+02:00', frontText: 'Røvær', id: 'c' })],
      },
    ],
    { stamp: ICS_STAMP }
  );
  assert.deepEqual(
    events.map((e) => icsTime(e.start)),
    ['20260715T060000Z', '20260715T104000Z', '20260715T190500Z']
  );
});

test('the same boat seen from both stop queries becomes one event', () => {
  const shared = { time: '2026-07-15T08:00:00+02:00', frontText: 'Haugesund', id: 'shared' };
  const events = feedEvents(
    [
      { direction: 'to-haugesund', calls: [call(shared)] },
      { direction: 'to-haugesund', calls: [call(shared)] },
    ],
    { stamp: ICS_STAMP }
  );
  assert.equal(events.length, 1);
});

test('the last boat of each day is marked for booking, not just the last of the month', () => {
  const events = feedEvents(
    [
      {
        direction: 'to-haugesund',
        calls: [
          call({ time: '2026-07-15T08:00:00+02:00', frontText: 'Haugesund', id: 'a' }),
          call({ time: '2026-07-15T21:05:00+02:00', frontText: 'Haugesund', id: 'b' }),
          call({ time: '2026-07-16T08:00:00+02:00', frontText: 'Haugesund', id: 'c' }),
          call({ time: '2026-07-16T21:05:00+02:00', frontText: 'Haugesund', id: 'd' }),
        ],
      },
    ],
    { stamp: ICS_STAMP }
  );
  assert.deepEqual(
    events.map((e) => e.isBooking),
    [false, true, false, true]
  );
});

test('a feed of a whole month is one valid calendar', () => {
  const calls = Array.from({ length: 30 }, (_, day) =>
    call({
      time: `2026-07-${String(day + 1).padStart(2, '0')}T08:00:00+02:00`,
      frontText: 'Haugesund',
      id: `journey-${day}`,
    })
  );
  const events = feedEvents([{ direction: 'to-haugesund', calls }], { stamp: ICS_STAMP });
  const ics = icsCalendar(events, { name: 'Rutebåten', ttlMinutes: FEED_TTL_MINUTES });
  assert.equal(events.length, 30);
  assert.equal(ics.split('\r\n').filter((l) => l === 'BEGIN:VEVENT').length, 30);
  assert.equal(new Set(events.map((e) => e.uid)).size, 30);
});

test('a stop list describing another day still dates the crossing from the departure', () => {
  // Entur answers a query about a future date with today's run of the same
  // journey: the clock times are right, the dates are today's. An event dated
  // off that list ends the day before it starts.
  const c = call({
    time: '2026-07-20T08:00:00+02:00',
    stops: [
      {
        quay: { stopPlace: { name: 'Røvær hurtigbåtkai' } },
        expectedDepartureTime: '2026-07-15T08:00:00+02:00',
        bookingArrangements: { minimumBookingPeriod: 'PT40M', bookingMethods: ['callDriver'] },
      },
      {
        quay: { stopPlace: { name: 'Haugesund hurtigbåtkai' } },
        expectedDepartureTime: '2026-07-15T08:25:00+02:00',
      },
    ],
  });
  const info = getRouteInfo(c);
  assert.equal(info.duration, 25);
  assert.equal(info.arrivalTime.toISOString(), new Date('2026-07-20T08:25:00+02:00').toISOString());
  assert.equal(toOsloDate(info.bookingDeadline), '2026-07-20');
  assert.equal(info.bookingDeadline.toISOString(), new Date('2026-07-20T07:20:00+02:00').toISOString());
});

test('no exported event ever ends before it starts', () => {
  const stale = (time) =>
    call({
      time,
      frontText: 'Haugesund',
      id: `j-${time}`,
      stops: [
        {
          quay: { stopPlace: { name: 'Røvær hurtigbåtkai' } },
          // Always today's dates, whatever day was asked about.
          expectedDepartureTime: '2026-07-15T08:00:00+02:00',
          bookingArrangements: null,
        },
        {
          quay: { stopPlace: { name: 'Haugesund hurtigbåtkai' } },
          expectedDepartureTime: '2026-07-15T08:25:00+02:00',
        },
      ],
    });
  const events = feedEvents(
    [
      {
        direction: 'to-haugesund',
        calls: ['2026-07-16', '2026-07-20', '2026-08-01'].map((d) => stale(`${d}T08:00:00+02:00`)),
      },
    ],
    { stamp: ICS_STAMP }
  );
  assert.equal(events.length, 3);
  for (const event of events) assert.ok(event.end > event.start, `${event.uid} ends before it starts`);
});
