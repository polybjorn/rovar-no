// node --test. Covers src/i18n/routes-core.js against fixture translation maps:
// a partial translation is a supported state, and the real content tree is
// complete, so the interesting cases have to be constructed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  translationsFromPaths,
  slugFor,
  pathFor,
  resolveRoute,
  allRoutes,
} from '../src/i18n/routes-core.js';
import { pages } from '../src/i18n/pages.js';
import { localeCodes, defaultLocale } from '../src/i18n/locales.js';

const pageByKey = Object.fromEntries(pages.map((p) => [p.key, p]));
const BASE = '/rovar-no';

// Everything translated everywhere, as the repo stands today.
const complete = Object.fromEntries(pages.map((p) => [p.key, new Set(localeCodes)]));

test('the content glob is read into a page -> languages map', () => {
  const map = translationsFromPaths([
    '../content/pages/no/home.md',
    '../content/pages/en/home.md',
    '../content/pages/en/ferry.md',
    '../content/pages/en/notes.txt',
  ]);
  assert.deepEqual([...map.home].sort(), ['en', 'no']);
  assert.deepEqual([...map.ferry], ['en']);
  assert.ok(!('notes' in map), 'non-markdown files are ignored');
});

test('the root language has no prefix, other languages do', () => {
  assert.equal(pathFor(pageByKey, BASE, 'explore', 'no'), '/rovar-no/opplev-oya-var/');
  assert.equal(pathFor(pageByKey, BASE, 'explore', 'en'), '/rovar-no/en/explore/');
  assert.equal(pathFor(pageByKey, BASE, 'explore', 'de'), '/rovar-no/de/explore/');
});

test('the front page keeps a trailing slash and gains no empty segment', () => {
  assert.equal(pathFor(pageByKey, BASE, 'home', 'no'), '/rovar-no/');
  assert.equal(pathFor(pageByKey, BASE, 'home', 'en'), '/rovar-no/en/');
});

test('every path starts from the base, so the Pages preview keeps working', () => {
  for (const code of localeCodes) {
    for (const p of pages) {
      assert.ok(
        pathFor(pageByKey, BASE, p.key, code).startsWith(`${BASE}/`),
        `${p.key} in ${code} escapes the base`
      );
    }
  }
});

test('at rovar.no, with no base, paths are still absolute', () => {
  assert.equal(pathFor(pageByKey, '', 'explore', 'no'), '/opplev-oya-var/');
  assert.equal(pathFor(pageByKey, '', 'home', 'no'), '/');
});

test('Norwegian keeps the original rovar.no slugs, other languages share English ones', () => {
  assert.equal(slugFor(pageByKey.ferry, 'no'), 'rutebaten');
  assert.equal(slugFor(pageByKey.ferry, 'en'), 'ferry');
  assert.equal(slugFor(pageByKey.ferry, 'de'), 'ferry');
});

test('an unknown page key throws rather than building a broken link', () => {
  assert.throws(() => pathFor(pageByKey, BASE, 'nope', 'no'), /Unknown page key/);
});

test('a translated page links to itself', () => {
  const r = resolveRoute(pageByKey, BASE, complete, 'history', 'de');
  assert.deepEqual(r, { href: '/rovar-no/de/history/', lang: 'de' });
});

test('an untranslated page falls back down the chain, not to a 404', () => {
  // German has no history page yet; English does.
  const partial = { ...complete, history: new Set(['no', 'en']) };
  const r = resolveRoute(pageByKey, BASE, partial, 'history', 'de');
  assert.deepEqual(r, { href: '/rovar-no/en/history/', lang: 'en' });
});

test('with only the default language present, the link goes there', () => {
  const partial = { ...complete, history: new Set(['no']) };
  const r = resolveRoute(pageByKey, BASE, partial, 'history', 'de');
  // The Norwegian fallback keeps the original rovar.no slug.
  assert.deepEqual(r, { href: '/rovar-no/rovaers-historie/', lang: 'no' });
});

test('a page nobody has translated still yields a usable default link', () => {
  const r = resolveRoute(pageByKey, BASE, {}, 'history', 'de');
  assert.equal(r.lang, defaultLocale);
  assert.equal(r.href, pathFor(pageByKey, BASE, 'history', defaultLocale));
});

test('allRoutes builds only the pages that have content', () => {
  const partial = { ...complete, history: new Set(['no']) };
  const built = allRoutes(pages, partial);
  const german = built.filter((r) => r.locale === 'de').map((r) => r.key);
  assert.ok(!german.includes('history'), 'an untranslated page must not be built');
  assert.equal(built.length, pages.length * localeCodes.length - (localeCodes.length - 1));
});

test('allRoutes slugs carry the language prefix and no trailing slash', () => {
  const built = allRoutes(pages, complete);
  const find = (key, locale) => built.find((r) => r.key === key && r.locale === locale).slug;
  assert.equal(find('home', 'no'), '');
  assert.equal(find('home', 'en'), 'en');
  assert.equal(find('explore', 'no'), 'opplev-oya-var');
  assert.equal(find('explore', 'de'), 'de/explore');
});

test('no two routes claim the same URL', () => {
  const slugs = allRoutes(pages, complete).map((r) => r.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});
