// npm run i18n:check             report to the terminal
// npm run i18n:check -- --write  also rewrite the status table in README.md
// npm run i18n:check -- --check  exit 1 if that table is out of date (CI, prebuild)
// Reports, per language: which pages are missing, which UI strings are missing,
// and which pages are still machine-translated drafts. At 15 languages some
// will always lag; this is what says how far behind they are.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { locales, defaultLocale } from '../src/i18n/locales.js';
import { pages } from '../src/i18n/pages.js';

const contentDir = 'src/content/pages';
const uiDir = 'src/i18n/ui';
const readmePath = 'README.md';
const startMarker = '<!-- i18n-status:start -->';
const endMarker = '<!-- i18n-status:end -->';

const write = process.argv.includes('--write');
const check = process.argv.includes('--check');
const quiet = check && !process.argv.includes('--verbose');

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

const stats = locales.map(({ code, endonym, root }) => {
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

  const done = present.length + (referenceKeys.length - missingKeys.length);
  const total = contentKeys.length + referenceKeys.length;

  return {
    code,
    endonym,
    prefix: root ? 'none (root)' : `\`/${code}/\``,
    present,
    missingPages,
    drafts,
    missingKeys,
    keysDone: referenceKeys.length - missingKeys.length,
    // Floor, so an incomplete language never rounds up to a full bar or 100%.
    percent: Math.floor((done / total) * 100),
    notes,
  };
});

if (!quiet) {
  for (const s of stats) {
    const pageCount = `${s.present.length}/${contentKeys.length} pages`;
    const keyCount = s.missingKeys.length ? `${s.missingKeys.length} UI strings missing` : 'UI complete';
    console.log(`${s.code}  ${s.endonym.padEnd(12)} ${pageCount.padEnd(12)} ${keyCount}`);

    if (s.missingPages.length) console.log(`     missing pages: ${s.missingPages.join(', ')}`);
    if (s.missingKeys.length && s.missingKeys.length <= 12)
      console.log(`     missing strings: ${s.missingKeys.join(', ')}`);
    if (s.drafts.length) console.log(`     awaiting review: ${s.drafts.join(', ')}`);
    for (const note of s.notes) console.log(`     ${note}`);
  }

  console.log(
    '\nMissing pages and strings fall back to the chain in src/i18n/locales.js;' +
      ' untranslated pages are left out of the language switcher.'
  );
}

if (write || check) {
  const bar = (percent) => {
    const filled = Math.floor((percent / 100) * 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
  };

  const rows = stats.map(
    (s) =>
      `| ${s.endonym} | ${s.prefix} | \`${bar(s.percent)}\` ${s.percent}% |` +
      ` ${s.present.length}/${contentKeys.length} | ${s.keysDone}/${referenceKeys.length} |`
  );

  const reviewing = stats.filter((s) => s.drafts.length);
  const footnotes = reviewing.map(
    (s) =>
      `\n${s.endonym}: ${s.drafts.length} machine-translated ` +
      `${s.drafts.length === 1 ? 'page' : 'pages'} awaiting review.`
  );

  const table = [
    '| Language | Prefix | Progress | Pages | UI strings |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');

  const block = `${startMarker}\n\n${table}\n${footnotes.join('')}\n${endMarker}`;
  const readme = readFileSync(readmePath, 'utf8');
  const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);

  if (!pattern.test(readme)) {
    console.error(`\n${readmePath} has no ${startMarker} / ${endMarker} block`);
    process.exit(1);
  }

  const updated = readme.replace(pattern, block);

  if (check) {
    if (updated !== readme) {
      console.error(
        `\n${readmePath}: the language status table is out of date.` +
          ' Run `npm run i18n:check -- --write` and commit the result.'
      );
      process.exit(1);
    }
    if (!quiet) console.log(`\n${readmePath} status table is up to date`);
  } else {
    writeFileSync(readmePath, updated);
    console.log(`\nWrote the status table to ${readmePath}`);
  }
}

process.exit(broken ? 1 : 0);
