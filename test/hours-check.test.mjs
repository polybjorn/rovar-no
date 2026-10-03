// node --test. Covers hours:check's reading and verdict
// (scripts/hours-check-core.mjs), against a page shaped like narbutikken.no's.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { storeHours, hoursDrift } from '../scripts/hours-check-core.mjs';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const page = (specs) =>
  `<html><script type="application/ld+json">{"@type":"Organization"}</script>` +
  `<script id="jsonLD" type="application/ld+json">${JSON.stringify({
    '@type': ['LocalBusiness', 'GroceryStore'],
    openingHoursSpecification: specs,
  })}</script></html>`;
const everyDay = (opens, closes) =>
  DAYS.map((d) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: `https://schema.org/${d}`, opens, closes }));

test('reads each day, with a midnight close as 24:00', () => {
  const hours = storeHours(page(everyDay('05:45:00', '00:00:00')));
  assert.deepEqual(hours.Monday, ['05:45', '24:00']);
  assert.equal(Object.keys(hours).length, 7);
});

test('a page without opening hours reads as none, not as closed', () => {
  assert.equal(storeHours('<html><p>Åpningstider</p></html>'), null);
  assert.equal(storeHours(page([])), null);
});

test('the same hours every day are no drift', () => {
  assert.deepEqual(hoursDrift(storeHours(page(everyDay('05:45:00', '00:00:00'))), ['05:45', '24:00']), []);
});

test('a changed day, or a day they no longer open, is drift', () => {
  const specs = everyDay('05:45:00', '00:00:00').filter((s) => !s.dayOfWeek.endsWith('Sunday'));
  specs[0] = { ...specs[0], closes: '23:00:00' };
  const drift = hoursDrift(storeHours(page(specs)), ['05:45', '24:00']);
  assert.deepEqual(drift.map((d) => [d.day, d.theirs]), [['Sunday', null], ['Monday', ['05:45', '23:00']]]);
});
