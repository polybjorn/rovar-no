// node --test. Covers src/i18n/ui-core.js: the per-key fallback that lets a
// half-translated catalog ship, and the {{placeholder}} filling. Fixture
// catalogs, because the real ones are complete and would prove nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { merge, fill, resolveCatalog, catalogIsDraft } from '../src/i18n/ui-core.js';
import { defaultLocale } from '../src/i18n/locales.js';

const catalogs = {
  no: {
    nav: { home: 'Hjem', ferry: 'Rutebåten', explore: 'Opplev øya vår' },
    footer: { contact: 'Kontakt {{oytingEmail}}' },
    board: { loading: 'Laster', empty: 'Ingen avganger' },
  },
  en: {
    nav: { home: 'Home', ferry: 'Ferry' },
    board: { loading: 'Loading' },
  },
  de: {
    _meta: { machineTranslated: true },
    nav: { home: 'Start' },
  },
};

const facts = { oytingEmail: 'rovaroyting@rovar.no' };

test('merge overlays without dropping the keys underneath', () => {
  const out = merge({ a: 1, nested: { x: 1, y: 2 } }, { nested: { y: 9 } });
  assert.deepEqual(out, { a: 1, nested: { x: 1, y: 9 } });
});

test('merge replaces arrays rather than blending them', () => {
  assert.deepEqual(merge({ words: ['a', 'b'] }, { words: ['c'] }), { words: ['c'] });
});

test('merge treats a missing override as nothing to do', () => {
  assert.deepEqual(merge({ a: 1 }, undefined), { a: 1 });
});

test('a half-translated catalog falls back key by key, not file by file', () => {
  const de = resolveCatalog(catalogs, 'de', facts);
  assert.equal(de.nav.home, 'Start', 'its own string wins');
  assert.equal(de.nav.ferry, 'Ferry', 'English fills the gap');
  assert.equal(de.nav.explore, 'Opplev øya vår', 'Norwegian is the last resort');
  assert.equal(de.board.empty, 'Ingen avganger');
});

test('English falls back straight to the default language', () => {
  const en = resolveCatalog(catalogs, 'en', facts);
  assert.equal(en.nav.ferry, 'Ferry');
  assert.equal(en.nav.explore, 'Opplev øya vår');
  assert.equal(en.board.loading, 'Loading');
});

test('the default language is unaffected by the others', () => {
  const no = resolveCatalog(catalogs, defaultLocale, facts);
  assert.equal(no.nav.home, 'Hjem');
  assert.equal(no.board.loading, 'Laster');
});

test('a language with no catalog at all still renders, English first', () => {
  const fr = resolveCatalog(catalogs, 'fr', facts);
  assert.equal(fr.nav.home, 'Home', 'the chain is English, then the default language');
  assert.equal(fr.nav.explore, 'Opplev øya vår', 'and Norwegian covers what English lacks');
});

test('placeholders are filled from the shared facts', () => {
  assert.equal(
    resolveCatalog(catalogs, defaultLocale, facts).footer.contact,
    'Kontakt rovaroyting@rovar.no'
  );
});

test('an unknown placeholder is left visible rather than blanked', () => {
  assert.equal(fill('Ring {{nosuchkey}}', facts), 'Ring {{nosuchkey}}');
});

test('placeholders are filled inside nested objects and arrays', () => {
  const out = fill({ a: { b: '{{oytingEmail}}' }, list: ['{{oytingEmail}}', 2] }, facts);
  assert.equal(out.a.b, 'rovaroyting@rovar.no');
  assert.deepEqual(out.list, ['rovaroyting@rovar.no', 2]);
});

test('non-string values survive filling untouched', () => {
  assert.deepEqual(fill({ n: 3, t: true, z: null }, facts), { n: 3, t: true, z: null });
});

test('catalog metadata never reaches the resolved strings', () => {
  assert.equal(resolveCatalog(catalogs, 'de', facts)._meta, undefined);
});

test('the draft flag is the catalog own, not inherited down the chain', () => {
  assert.equal(catalogIsDraft(catalogs, 'de'), true);
  assert.equal(catalogIsDraft(catalogs, 'en'), false, 'a reviewed catalog stays reviewed');
  assert.equal(catalogIsDraft(catalogs, 'fr'), false, 'no catalog at all is not a draft');
});

test('resolving a catalog does not mutate the catalogs it was given', () => {
  const before = JSON.stringify(catalogs);
  resolveCatalog(catalogs, 'de', facts);
  assert.equal(JSON.stringify(catalogs), before);
});
