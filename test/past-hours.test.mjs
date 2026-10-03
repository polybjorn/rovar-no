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
