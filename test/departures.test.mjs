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
  bookingPattern,
  situationTexts,
  noticeState,
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

const call = ({ time, frontText = 'Haugesund', stops, passingTimes, notices, situations }) => ({
  expectedDepartureTime: time,
  destinationDisplay: { frontText },
  serviceJourney: {
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

const strings = {
  bookingWords: ['booking', 'reserve'],
  lastNotice: 'Siste avgang',
  bookingNotice: 'Ring for å bestille',
};
const re = bookingPattern(strings.bookingWords);

test('the booking pattern matches Norwegian and the language own words', () => {
  assert.ok(re.test('Må bestilles på forhånd'));
  assert.ok(re.test('Advance BOOKING required'));
  assert.ok(!re.test('Går ikke i skoleferien'));
});

test('bookingArrangements alone marks a departure as bestillingsrute', () => {
  const state = noticeState({
    call: call({ time: '2026-07-15T08:00:00+02:00' }),
    hasBooking: true,
    isLast: false,
    strings,
    bookingRe: re,
  });
  assert.equal(state.isBooking, true);
  assert.deepEqual(state.allTexts, [strings.bookingNotice]);
  assert.deepEqual(state.infoTexts, [], 'the booking text is not repeated as an info notice');
});

test('an API notice that already says bestill is not doubled up', () => {
  const state = noticeState({
    call: call({
      time: '2026-07-15T08:00:00+02:00',
      notices: [{ text: 'Turen må bestilles innen kl 20' }],
    }),
    hasBooking: true,
    isLast: true,
    strings,
    bookingRe: re,
  });
  assert.deepEqual(state.allTexts, ['Turen må bestilles innen kl 20']);
  assert.equal(state.isBooking, true);
});

test('the last departure gets the soft notice only when nothing else says booking', () => {
  const base = { call: call({ time: '2026-07-15T22:00:00+02:00' }), strings, bookingRe: re };
  assert.deepEqual(
    noticeState({ ...base, hasBooking: false, isLast: true }).allTexts,
    [strings.lastNotice]
  );
  assert.deepEqual(noticeState({ ...base, hasBooking: false, isLast: false }).allTexts, []);
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
    strings,
    bookingRe: re,
  });
  assert.deepEqual(state.allTexts, ['Kun skoledager', 'Innstilt ved kuling']);
  assert.deepEqual(state.infoTexts, state.allTexts);
  assert.equal(state.isBooking, false);
});

test('an empty situation summary is dropped rather than rendered blank', () => {
  assert.deepEqual(situationTexts({ situations: [{ summary: [] }, { summary: null }] }), []);
});

// --- presentation -----------------------------------------------------------

const cd = { now: 'nå', inPre: 'om', minUnit: 'min', hourUnit: 't' };

test('formatCountdown reads naturally at every scale', () => {
  assert.equal(formatCountdown(0, cd), 'nå');
  assert.equal(formatCountdown(-5, cd), 'nå');
  assert.equal(formatCountdown(12, cd), 'om 12 min');
  assert.equal(formatCountdown(59, cd), 'om 59 min');
  assert.equal(formatCountdown(60, cd), 'om 1 t');
  assert.equal(formatCountdown(95, cd), 'om 1 t 35 min');
  assert.equal(formatCountdown(120, cd), 'om 2 t');
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
