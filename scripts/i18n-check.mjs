// npm run i18n:check
// Reports, per language: which pages are missing, which UI strings are missing,
// and which pages are still machine-translated drafts. At 15 languages some
// will always lag; this is what says how far behind they are.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { locales, defaultLocale } from '../src/i18n/locales.js';
import { pages } from '../src/i18n/pages.js';

const contentDir = 'src/content/pages';
const uiDir = 'src/i18n/ui';

const contentKeys = pages.map((p) => p.key);

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? flatten(v, `${prefix}${k}.`)
      : [`${prefix}${k}`]
  );

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const referenceKeys = flatten(readJson(`${uiDir}/${defaultLocale}.json`));

let broken = false;

for (const { code, endonym } of locales) {
  const notes = [];

  const dir = `${contentDir}/${code}`;
  const present = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
    : [];
  const missingPages = contentKeys.filter((k) => !present.includes(k));

  const drafts = present.filter((key) =>
    /^machineTranslated:\s*true\s*$/m.test(readFileSync(`${dir}/${key}.md`, 'utf8'))
  );

  const catalogPath = `${uiDir}/${code}.json`;
  let missingKeys = referenceKeys;
  if (existsSync(catalogPath)) {
    const own = new Set(flatten(readJson(catalogPath)));
    missingKeys = referenceKeys.filter((k) => !own.has(k));
  } else {
    notes.push('no UI catalog');
    broken = true;
  }

  const pageCount = `${present.length}/${contentKeys.length} pages`;
  const keyCount = missingKeys.length ? `${missingKeys.length} UI strings missing` : 'UI complete';
  console.log(`${code}  ${endonym.padEnd(12)} ${pageCount.padEnd(12)} ${keyCount}`);

  if (missingPages.length) console.log(`     missing pages: ${missingPages.join(', ')}`);
  if (missingKeys.length && missingKeys.length <= 12)
    console.log(`     missing strings: ${missingKeys.join(', ')}`);
  if (drafts.length) console.log(`     awaiting review: ${drafts.join(', ')}`);
  for (const note of notes) console.log(`     ${note}`);
}

console.log(
  '\nMissing pages and strings fall back to the chain in src/i18n/locales.js;' +
    ' untranslated pages are left out of the language switcher.'
);

process.exit(broken ? 1 : 0);
