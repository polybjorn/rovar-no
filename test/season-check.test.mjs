// node --test. Covers season:check's verdict (scripts/season-check-core.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { seasonStatus } from '../scripts/season-check-core.mjs';

const states = (lastDays, today) =>
  Object.fromEntries(seasonStatus(lastDays, today).map((r) => [r.key, r.state]));

test('a season holds through its last day and is over the day after', () => {
  assert.deepEqual(states({ end: '2026-08-16' }, '2026-08-16'), { end: 'current' });
  assert.deepEqual(states({ end: '2026-08-16' }, '2026-08-17'), { end: 'over' });
});

test('last year\'s dates are only over until the reminder starts', () => {
  assert.deepEqual(states({ end: '2026-08-16' }, '2027-02-28'), { end: 'over' });
  assert.deepEqual(states({ end: '2026-08-16' }, '2027-03-01'), { end: 'stale' });
});

test('next year\'s dates entered early are not stale', () => {
  assert.deepEqual(
    states({ end: '2026-08-16', hiltaSeason: '2027-08-29' }, '2027-03-01'),
    { end: 'stale', hiltaSeason: 'current' }
  );
});

test('rows come in date order', () => {
  const rows = seasonStatus({ b: '2026-09-30', a: '2026-08-16' }, '2026-01-01');
  assert.deepEqual(rows.map((r) => r.key), ['a', 'b']);
});
