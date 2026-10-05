// node --test. Covers striking through past hours: which season day a row
// names (season-format) and whether that day is over (past-hours-core).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { season } from '../src/data/season.js';
import { lastDayIn } from '../src/i18n/season-format.js';
import { pastState } from '../src/scripts/past-hours-core.js';

const dayAfter = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

test('a row is dated by the last season day it names', () => {
  assert.equal(lastDayIn('kl. {{sjohusSummer}} til {{end}}'), season.end);
  assert.equal(lastDayIn('kl. {{sjohusAutumn}} {{autumn}}'), season.autumn[1]);
  assert.equal(lastDayIn('Etter {{end}}: {{autumn}}'), season.autumn[1]);
  assert.equal(lastDayIn('{{hiltaSeason}} {{hiltaSeasonYear}}'), season.hiltaSeason[1]);
});

test('a row without a season date is not dated', () => {
  assert.equal(lastDayIn('{{ribPriceAdult}} voksne · {{ribPriceChild}} barn'), undefined);
  assert.equal(lastDayIn('Avganger {{year}}'), undefined);
});

test('a row holds through its last day and is past the day after', () => {
  assert.deepEqual(pastState([season.end], season.end), { past: [false], allPast: false });
  assert.deepEqual(pastState([season.end], dayAfter(season.end)), { past: [true], allPast: true });
});

test('the list is only waiting for next season once every dated row is past', () => {
  const rows = [season.end, season.autumn[1]];
  assert.equal(pastState(rows, dayAfter(season.end)).allPast, false);
  assert.equal(pastState(rows, dayAfter(season.autumn[1])).allPast, true);
  assert.equal(pastState([], '2099-01-01').allPast, false);
});

// --- whether a place is open now ---------------------------------------------

import { daysIn } from '../src/i18n/weekdays.js';
import { hoursIn, firstDayIn, firstDayShown } from '../src/i18n/season-format.js';
import { hoursStatus, weekdayOf, repeatsRow } from '../src/scripts/past-hours-core.js';

test('an hours label names its days in each language', () => {
  assert.deepEqual(daysIn('Hver dag:', 'no'), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(daysIn('Søndag og torsdag:', 'no'), [0, 4]);
  assert.deepEqual(daysIn('Torsdag til lørdag:', 'no'), [4, 5, 6]);
  assert.deepEqual(daysIn('Sundays and Thursdays:', 'en'), [0, 4]);
  assert.deepEqual(daysIn('Sunday to Wednesday:', 'en'), [0, 1, 2, 3]);
  assert.deepEqual(daysIn('Samstags und sonntags:', 'de'), [0, 6]);
  assert.deepEqual(daysIn('Täglich:', 'de'), [0, 1, 2, 3, 4, 5, 6]);
  // A range that runs over the week's end.
  assert.deepEqual(daysIn('Fredag til mandag:', 'no'), [0, 1, 5, 6]);
});

test('a label that names no days is not read as some', () => {
  assert.equal(daysIn('Avganger:', 'no'), undefined);
  assert.equal(daysIn('Søndag og helligdager:', 'no'), undefined);
  assert.equal(daysIn('Sunday to whenever:', 'en'), undefined);
});

// Every hours row on the site, read the way remark-content reads it. The build
// fails on one it cannot read; this says which, without a build.
test('every hours row on the site has a label naming its days', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  for (const code of readdirSync('src/content/pages')) {
    for (const file of readdirSync(`src/content/pages/${code}`)) {
      const text = readFileSync(`src/content/pages/${code}/${file}`, 'utf8');
      for (const [, label, rest] of text.matchAll(/^[-*] \*\*([^*]+)\*\*(.*)$/gm)) {
        if (!hoursIn(rest) || !lastDayIn(rest)) continue;
        assert.ok(daysIn(label, code), `${code}/${file}: "${label}"`);
      }
    }
  }
});

test('a row ranging over dates starts on its first one, a "til" row on the season\'s', () => {
  assert.equal(firstDayIn('{{sjohusAutumn}} _{{autumn}}_'), season.autumn[0]);
  assert.equal(firstDayIn('{{sjohusSummer}} _til {{end}}_'), season.start ?? undefined);
  assert.deepEqual(hoursIn('kl. {{hotelSunWed}} matservering kl. {{hotelSunWedFood}}'), season.hotelSunWed);
  assert.equal(hoursIn('hver dag kl. {{ribDepartures}}'), undefined);
});

// Without it, next year's "til {{end}}" rows entered in winter say open now.
test('every summer season after 2026 names its first day, before its last', () => {
  assert.ok(season.start || season.year === 2026, 'season.start is missing from src/data/season.js');
  assert.ok(!season.start || season.start <= season.end, 'season.start is after season.end');
});

// Sjøhus: every day 11-16 until 16 August 2026 (a Sunday), then weekends 11-15.
const sjohus = [
  { days: [0, 1, 2, 3, 4, 5, 6], until: '2026-08-16', open: '11:00', close: '16:00' },
  { days: [0, 6], from: '2026-08-17', until: '2026-09-30', open: '11:00', close: '15:00' },
];
const at = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const brief = (s) => s && { state: s.state, date: s.date, inDays: s.inDays, open: s.row.open, close: s.row.close };

test('open from opening time until the minute it closes', () => {
  assert.equal(hoursStatus(sjohus, '2026-07-01', at('10:59')).state, 'opens');
  assert.deepEqual(brief(hoursStatus(sjohus, '2026-07-01', at('11:00'))),
    { state: 'open', date: undefined, inDays: undefined, open: '11:00', close: '16:00' });
  assert.equal(hoursStatus(sjohus, '2026-07-01', at('15:59')).state, 'open');
  assert.equal(hoursStatus(sjohus, '2026-07-01', at('16:00')).state, 'opens');
});

test('closed for the day opens tomorrow, or on the next day it is open', () => {
  assert.deepEqual(brief(hoursStatus(sjohus, '2026-07-01', at('09:00'))),
    { state: 'opens', date: '2026-07-01', inDays: 0, open: '11:00', close: '16:00' });
  assert.deepEqual(brief(hoursStatus(sjohus, '2026-07-01', at('17:00'))),
    { state: 'opens', date: '2026-07-02', inDays: 1, open: '11:00', close: '16:00' });
  // After the last summer day the next opening is the first autumn Saturday.
  const next = hoursStatus(sjohus, '2026-08-16', at('17:00'));
  assert.equal(next.date, '2026-08-22');
  assert.equal(weekdayOf(next.date), 6);
  assert.equal(next.row.close, '15:00');
});

test('the latest closing wins when two rows are open at once', () => {
  const hotel = [
    { days: [0, 1, 2, 3], until: '2026-08-16', open: '12:00', close: '20:00' },
    { days: [3], until: '2026-08-16', open: '12:00', close: '21:00' },
  ];
  assert.equal(hoursStatus(hotel, '2026-07-01', at('13:00')).row.close, '21:00');
});

test('before its season a place opens on its first day; after it, never', () => {
  const hilta = [{ days: [0, 4], from: '2027-06-20', until: '2027-08-29', open: '13:30', close: '15:30' }];
  const next = hoursStatus(hilta, '2026-10-03', at('12:00'));
  assert.equal(next.date, '2027-06-20');
  assert.equal(hoursStatus(hilta, '2027-08-29', at('16:00')), null);
  assert.equal(hoursStatus(sjohus, '2026-10-01', at('12:00')), null);
});

test('a range row prints its first day, a "til" row does not', () => {
  assert.equal(firstDayShown('kl. {{sjohusAutumn}} _{{autumn}}_'), true);
  assert.equal(firstDayShown('kl. {{sjohusSummer}} _til {{end}}_'), false);
  assert.equal(firstDayShown('kl. {{narbutikkenHours}}'), false);
});

// "Stengt nå. Åpner søndag 20. juni kl. 13.30." right under the row that says so.
test('a status that only repeats the first day its row prints says nothing', () => {
  const hilta = [{ days: [0, 4], from: '2027-06-20', until: '2027-08-29', open: '13:30', close: '15:30', fromShown: true }];
  assert.equal(repeatsRow(hoursStatus(hilta, '2026-10-03', at('12:00'))), true);
  // Within the week it says "this Sunday", which the row does not.
  assert.equal(repeatsRow(hoursStatus(hilta, '2027-06-17', at('12:00'))), false);
  // After the first day the next opening is not one the row prints.
  assert.equal(repeatsRow(hoursStatus(hilta, '2027-06-21', at('12:00'))), false);
  // A "til" row does not print its first day.
  assert.equal(repeatsRow(hoursStatus([{ ...hilta[0], fromShown: false }], '2026-10-03', at('12:00'))), false);
});

test('a row with no dates holds all year, and is open until midnight', () => {
  const shop = [{ days: [0, 1, 2, 3, 4, 5, 6], open: '05:45', close: '24:00' }];
  assert.equal(hoursStatus(shop, '2026-12-24', at('23:59')).state, 'open');
  assert.deepEqual(brief(hoursStatus(shop, '2026-12-24', at('03:00'))),
    { state: 'opens', date: '2026-12-24', inDays: 0, open: '05:45', close: '24:00' });
  assert.equal(hoursStatus(shop, '2031-02-01', at('12:00')).state, 'open');
});

// --- when the next RIB tour leaves -------------------------------------------

import { departuresIn } from '../src/i18n/season-format.js';
import { nextDeparture } from '../src/scripts/past-hours-core.js';

test('a departures row names its times, an hours row none', () => {
  assert.deepEqual(departuresIn('hver dag kl. {{ribDepartures}} _til {{end}}_'), season.ribDepartures);
  assert.equal(departuresIn('kl. {{sjohusSummer}} _til {{end}}_'), undefined);
});

// The RIB tour: every day at 11:30 and 14:15 until 16 August 2026.
const rib = [{ days: [0, 1, 2, 3, 4, 5, 6], until: '2026-08-16', times: ['11:30', '14:15'], texts: ['11.30', '14.15'] }];
const leaves = (s) => s && { state: s.state, date: s.date, inDays: s.inDays, time: s.row.open, text: s.row.openText };

test('the next departure is the first one later today, else tomorrow', () => {
  assert.deepEqual(leaves(nextDeparture(rib, '2026-07-01', at('09:00'))),
    { state: 'opens', date: '2026-07-01', inDays: 0, time: '11:30', text: '11.30' });
  assert.deepEqual(leaves(nextDeparture(rib, '2026-07-01', at('12:00'))),
    { state: 'opens', date: '2026-07-01', inDays: 0, time: '14:15', text: '14.15' });
  // A boat leaving this minute is gone, and never counts as open.
  assert.deepEqual(leaves(nextDeparture(rib, '2026-07-01', at('14:15'))),
    { state: 'opens', date: '2026-07-02', inDays: 1, time: '11:30', text: '11.30' });
});

test('no departure is left after the last day', () => {
  assert.equal(nextDeparture(rib, '2026-08-16', at('15:00')), null);
  assert.equal(nextDeparture(rib, '2026-10-01', at('09:00')), null);
});
