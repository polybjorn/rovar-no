// node --test. Covers the language registry and the seasonal formatter, the two
// places where a wrong value is invisible in the build but wrong on the page.
// routes.js and ui.js are not here: both use import.meta.glob, so they need a
// Vite-aware runner rather than plain node.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { locales, defaultLocale, localeCodes, lookupOrder, localeInfo } from '../src/i18n/locales.js';
import { seasonStrings } from '../src/i18n/season-format.js';
import { phoneStrings } from '../src/i18n/phone-format.js';
import { season } from '../src/data/season.js';
import { facts } from '../src/data/facts.js';
import { pages } from '../src/i18n/pages.js';

test('exactly one root language, and it is the default', () => {
  const roots = locales.filter((l) => l.root);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].code, defaultLocale);
});

test('locale codes are unique and every locale is fully described', () => {
  assert.equal(new Set(localeCodes).size, localeCodes.length);
  for (const l of locales) {
    assert.ok(l.endonym, `${l.code} has no endonym`);
    assert.ok(l.intl, `${l.code} has no intl tag`);
    assert.ok(l.og, `${l.code} has no og locale`);
    assert.ok(['ltr', 'rtl'].includes(l.dir), `${l.code} has a bad dir`);
  }
});

test('lookupOrder puts the language first, then the fallback chain, without repeats', () => {
  for (const code of localeCodes) {
    const order = lookupOrder(code);
    assert.equal(order[0], code);
    assert.equal(new Set(order).size, order.length);
    assert.ok(order.includes(defaultLocale), `${code} never falls back to ${defaultLocale}`);
  }
});

test('an unknown language falls back instead of throwing', () => {
  assert.deepEqual(lookupOrder('xx'), lookupOrder('xx').filter((c) => localeCodes.includes(c)));
  assert.equal(localeInfo('xx').code, defaultLocale);
});

test('page keys and per-language slugs are unique', () => {
  const keys = pages.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);

  for (const code of localeCodes) {
    const slugs = pages.map((p) => p.slugs[code] ?? p.slug);
    assert.equal(new Set(slugs).size, slugs.length, `duplicate slug in ${code}`);
  }
});

test('exactly one page is the front page, in every language', () => {
  for (const code of localeCodes) {
    const empty = pages.filter((p) => (p.slugs[code] ?? p.slug) === '');
    assert.equal(empty.length, 1, `${code} has ${empty.length} pages with an empty slug`);
  }
});

test('every language formats every seasonal value', () => {
  for (const code of localeCodes) {
    const s = seasonStrings(code);
    assert.equal(s.year, String(season.year));
    assert.ok(s.end.length, `${code} has no formatted end date`);
    for (const [key, value] of Object.entries(season)) {
      if (!Array.isArray(value) || value.length !== 2 || key === 'ribDepartures') continue;
      assert.ok(s[key], `${code} is missing ${key}`);
    }
  }
});

test('Norwegian writes the clock with a period, English with a colon', () => {
  assert.match(seasonStrings('no').sjohusSummer, /11\.00/);
  assert.match(seasonStrings('en').sjohusSummer, /11:00/);
});

test('German uses its own range template, not an en dash', () => {
  const de = seasonStrings('de').sjohusSummer;
  assert.match(de, /bis/);
  assert.ok(!de.includes('–'), 'German range still uses the default template');
});

test('a range renders both ends, in order', () => {
  for (const code of localeCodes) {
    const [from, to] = season.sjohusSummer;
    const rendered = seasonStrings(code).sjohusSummer;
    const hour = (t) => t.split(':')[0];
    assert.ok(
      rendered.indexOf(hour(from)) < rendered.lastIndexOf(hour(to)),
      `${code} renders ${rendered} for ${from}-${to}`
    );
  }
});

test('the RIB departures are joined as a list, not concatenated', () => {
  const rendered = seasonStrings('no').ribDepartures;
  for (const t of season.ribDepartures) assert.ok(rendered.includes(t.split(':')[0]));
  assert.ok(/\s/.test(rendered), 'departures are not separated');
});

test('Norwegian keeps the local phone form, every other language gets the country code', () => {
  assert.equal(phoneStrings('no').havhotellPhone, facts.havhotellPhone);
  assert.equal(phoneStrings('en').havhotellPhone, `+47 ${facts.havhotellPhone}`);
  assert.equal(phoneStrings('de').havhotellPhone, `+47 ${facts.havhotellPhone}`);
});

test('every phone number in facts is formatted for every language', () => {
  const keys = Object.keys(facts).filter((k) => k.endsWith('Phone'));
  assert.ok(keys.length, 'no phone numbers found in facts');
  for (const code of localeCodes) {
    const phones = phoneStrings(code);
    for (const key of keys) {
      assert.ok(phones[key], `${code} is missing ${key}`);
      assert.match(phones[key], /\d/, `${code} ${key} has no digits`);
    }
  }
});

test('the country code is added once, never doubled', () => {
  for (const code of localeCodes) {
    for (const value of Object.values(phoneStrings(code))) {
      assert.equal(value.match(/\+47/g)?.length ?? 0, code === defaultLocale ? 0 : 1, value);
    }
  }
});

test('a new language gets the country code without touching any code', () => {
  // Guards the i18n promise: adding a locale is a registry line, nothing more.
  const unknown = phoneStrings('sv');
  assert.equal(unknown.havhotellPhone, `+47 ${facts.havhotellPhone}`);
});
