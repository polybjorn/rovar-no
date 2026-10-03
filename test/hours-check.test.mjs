// node --test. Covers hours:check's reading and verdict
// (scripts/hours-check-core.mjs), against a page shaped like narbutikken.no's.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { storeHours, printedHours, hoursDrift } from '../scripts/hours-check-core.mjs';
import { season } from '../src/data/season.js';

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

const week = (hours) => Object.fromEntries(DAYS.map((d) => [d, hours]));
const shop = (rows) => `## Mat\n\n### Nærbutikken Røvær\n\nTekst.\n\n${rows}\n\n- [Facebook](x)\n\n### Neste\n\n* **Hver dag:** kl. {{hotelAutumn}}\n`;

test('our hours are read per day from the rows under the heading only', () => {
  assert.deepEqual(printedHours(shop('* **Hver dag:** kl. {{narbutikkenHours}}'), 'Nærbutikken Røvær', 'no'),
    week(season.narbutikkenHours));
  const split = printedHours(
    shop('* **Mandag til lørdag:** kl. {{narbutikkenHours}}\n* **Søndag:** kl. {{hotelAutumn}}'),
    'Nærbutikken Røvær', 'no');
  assert.deepEqual(split.Saturday, season.narbutikkenHours);
  assert.deepEqual(split.Sunday, season.hotelAutumn);
  assert.equal(printedHours(shop('Ingen tider.'), 'Nærbutikken Røvær', 'no'), null);
});

test('the same hours every day are no drift', () => {
  assert.deepEqual(hoursDrift(storeHours(page(everyDay('05:45:00', '00:00:00'))), week(['05:45', '24:00'])), []);
});

test('a changed day, or a day they no longer open, is drift, and only that day', () => {
  const specs = everyDay('05:45:00', '00:00:00').filter((s) => !s.dayOfWeek.endsWith('Sunday'));
  specs[0] = { ...specs[0], closes: '23:00:00' };
  const drift = hoursDrift(storeHours(page(specs)), week(['05:45', '24:00']));
  assert.deepEqual(drift.map((d) => [d.day, d.theirs]), [['Sunday', null], ['Monday', ['05:45', '23:00']]]);
});

test('a day we print apart matches when theirs moved the same way', () => {
  const specs = everyDay('05:45:00', '00:00:00').map((s) =>
    s.dayOfWeek.endsWith('Sunday') ? { ...s, opens: '09:00:00', closes: '22:00:00' } : s);
  const ours = { ...week(['05:45', '24:00']), Sunday: ['09:00', '22:00'] };
  assert.deepEqual(hoursDrift(storeHours(page(specs)), ours), []);
});
