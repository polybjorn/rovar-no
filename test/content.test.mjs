// node --test. Registry against the file tree: the failures here are the ones
// that produce a silently missing page or a string that quietly falls back to
// another language, neither of which breaks the build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

import { localeCodes, defaultLocale } from '../src/i18n/locales.js';
import { pages } from '../src/i18n/pages.js';

const contentDir = 'src/content/pages';
const uiDir = 'src/i18n/ui';

const pageKeys = pages.map((p) => p.key);
const filesFor = (code) =>
  existsSync(`${contentDir}/${code}`)
    ? readdirSync(`${contentDir}/${code}`)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''))
    : [];

// _-prefixed keys are catalog metadata (_meta.machineTranslated), not strings,
// so they are not measured against the default language.
const flatten = (obj, prefix = '') =>
  Object.entries(obj)
    .filter(([k]) => !k.startsWith('_'))
    .flatMap(([k, v]) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? flatten(v, `${prefix}${k}.`)
        : [`${prefix}${k}`]
    );

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('the default language has every page', () => {
  assert.deepEqual(filesFor(defaultLocale).sort(), [...pageKeys].sort());
});

test('no content file is named after something that is not a page', () => {
  for (const code of localeCodes) {
    for (const key of filesFor(code)) {
      assert.ok(pageKeys.includes(key), `${code}/${key}.md matches no page key`);
    }
  }
});

test('every content file has a title and a description', () => {
  for (const code of localeCodes) {
    for (const key of filesFor(code)) {
      const raw = readFileSync(`${contentDir}/${code}/${key}.md`, 'utf8');
      const frontmatter = raw.match(/^---\n([\s\S]*?)\n---/)?.[1];
      assert.ok(frontmatter, `${code}/${key}.md has no frontmatter`);
      assert.match(frontmatter, /^title:\s*\S/m, `${code}/${key}.md has no title`);
      assert.match(frontmatter, /^description:\s*\S/m, `${code}/${key}.md has no description`);
    }
  }
});

test('every language has a UI catalog and it parses', () => {
  for (const code of localeCodes) {
    const path = `${uiDir}/${code}.json`;
    assert.ok(existsSync(path), `${code} has no UI catalog`);
    assert.doesNotThrow(() => readJson(path), `${code}.json is not valid JSON`);
  }
});

test('no catalog carries a key the default language does not define', () => {
  const reference = new Set(flatten(readJson(`${uiDir}/${defaultLocale}.json`)));
  for (const code of localeCodes) {
    if (code === defaultLocale) continue;
    for (const key of flatten(readJson(`${uiDir}/${code}.json`))) {
      assert.ok(reference.has(key), `${code}.json defines ${key}, which no longer exists`);
    }
  }
});

test('a catalog file is only present for a language in the registry', () => {
  const catalogs = readdirSync(uiDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
  for (const code of catalogs) {
    assert.ok(localeCodes.includes(code), `${code}.json has no entry in locales.js`);
  }
});
