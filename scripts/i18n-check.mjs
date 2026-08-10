// npm run i18n:check             report to the terminal
// npm run i18n:check -- --write  also rewrite the status table in README.md
// npm run i18n:check -- --check  exit 1 if that table is out of date (CI, prebuild)
// Reports, per language: which pages are missing, which UI strings are missing,
// and which pages are still machine-translated drafts. At 15 languages some
// will always lag; this is what says how far behind they are.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { locales, defaultLocale } from '../src/i18n/locales.js';
import { pages } from '../src/i18n/pages.js';
import { catalogIsDraft } from '../src/i18n/ui-core.js';
import { treeUrl } from '../src/data/site.js';

const contentDir = 'src/content/pages';
const uiDir = 'src/i18n/ui';
const readmePath = 'README.md';
const startMarker = '<!-- i18n-status:start -->';
const endMarker = '<!-- i18n-status:end -->';

const write = process.argv.includes('--write');
const check = process.argv.includes('--check');
const quiet = check && !process.argv.includes('--verbose');

const contentKeys = pages.map((p) => p.key);

// _meta is catalog metadata, not a string to translate: out of the counts.
const flatten = (obj, prefix = '') =>
  Object.entries(obj)
    .filter(([k]) => !k.startsWith('_'))
    .flatMap(([k, v]) =>
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
  let catalogDraft = false;
  if (existsSync(catalogPath)) {
    const catalog = readJson(catalogPath);
    const own = new Set(flatten(catalog));
    missingKeys = referenceKeys.filter((k) => !own.has(k));
    catalogDraft = catalogIsDraft({ [code]: catalog }, code);
  } else {
    notes.push('no UI catalog');
    broken = true;
  }

  const keysDone = referenceKeys.length - missingKeys.length;
  const total = contentKeys.length + referenceKeys.length;

  // Present and reviewed are different things, and only the second one means
  // the language is done. A scaffolded language is 100% present the day it is
  // created: every page and string exists, none of it has been read by anyone
  // who speaks it. Counting presence alone would report that as complete.
  const drafted = drafts.length + (catalogDraft ? keysDone : 0);
  const reviewed = present.length + keysDone - drafted;

  return {
    code,
    endonym,
    prefix: root ? 'none (root)' : `\`/${code}/\``,
    present,
    root,
    missingPages,
    drafts,
    catalogDraft,
    missingKeys,
    keysDone,
    drafted,
    reviewed,
    total,
    // Floor, so an unfinished language never rounds up to a full bar or 100%.
    percent: Math.floor((reviewed / total) * 100),
    notes,
  };
});

if (!quiet) {
  for (const s of stats) {
    const pageCount = `${s.present.length}/${contentKeys.length} pages`;
    const keyCount = s.missingKeys.length
      ? `${s.missingKeys.length} UI strings missing`
      : s.catalogDraft
        ? 'UI translated, unreviewed'
        : 'UI complete';
    // "5/5 pages, UI complete" is true of a language nobody has read yet, so
    // say which of it has actually been reviewed.
    const state = s.reviewed === s.total ? 'reviewed' : `${s.percent}% reviewed`;
    console.log(`${s.code}  ${s.endonym.padEnd(12)} ${pageCount.padEnd(12)} ${keyCount.padEnd(26)} ${state}`);

    if (s.missingPages.length) console.log(`     missing pages: ${s.missingPages.join(', ')}`);
    if (s.missingKeys.length && s.missingKeys.length <= 12)
      console.log(`     missing strings: ${s.missingKeys.join(', ')}`);
    if (s.drafts.length) console.log(`     awaiting review: ${s.drafts.join(', ')}`);
    if (s.catalogDraft) console.log(`     awaiting review: UI catalog (${s.code}.json)`);
    for (const note of s.notes) console.log(`     ${note}`);
  }

  console.log(
    '\nMissing pages and strings fall back to the chain in src/i18n/locales.js;' +
      ' untranslated pages are left out of the language switcher.'
  );
}

if (write || check) {
  // Three states, because a language has three: reviewed, machine-translated
  // and waiting for a human, and not there at all.
  const cells = 10;
  const bar = (s) => {
    const full = Math.floor((s.reviewed / s.total) * cells);
    const draft = Math.min(cells - full, Math.ceil((s.drafted / s.total) * cells));
    return '█'.repeat(full) + '▒'.repeat(draft) + '░'.repeat(cells - full - draft);
  };

  // The number next to the bar counts reviewed content only, so it never says
  // 100% for a language nobody has read.
  const progress = (s) => {
    if (s.reviewed === s.total) return '100%';
    if (!s.reviewed && s.drafted) return 'machine-translated';
    return `${s.percent}% reviewed`;
  };

  // A count that includes drafts is marked, so 5/5 never reads as 5 finished.
  const count = (done, of, isDraft) => `${done}/${of}${isDraft ? ' ▒' : ''}`;

  // The default language is the source text, not a translation: it gets no
  // "improve this" link, because the page copy is the original rovar.no wording.
  const contribute = (s) =>
    s.root
      ? 'source text'
      : `[pages](${treeUrl(`${contentDir}/${s.code}`)}) · ` +
        `[UI](${treeUrl(`${uiDir}/${s.code}.json`)})`;

  const rows = stats.map(
    (s) =>
      `| ${s.endonym} | ${s.prefix} | \`${bar(s)}\` ${progress(s)} |` +
      ` ${count(s.present.length, contentKeys.length, s.drafts.length)} |` +
      ` ${count(s.keysDone, referenceKeys.length, s.catalogDraft)} |` +
      ` ${contribute(s)} |`
  );

  const reviewing = stats.filter((s) => s.drafts.length || s.catalogDraft);
  const footnotes = reviewing.map((s) => {
    const parts = [];
    if (s.drafts.length)
      parts.push(`${s.drafts.length} ${s.drafts.length === 1 ? 'page' : 'pages'}`);
    if (s.catalogDraft) parts.push('the UI catalog');
    return `\n${s.endonym}: ${parts.join(' and ')} machine-translated, awaiting review.`;
  });

  const key = reviewing.length
    ? '\n`█` reviewed by a speaker · `▒` machine-translated, not yet reviewed ·' +
      ' `░` not translated\n'
    : '';

  const table = [
    '| Language | Prefix | Progress | Pages | UI strings | Improve |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');

  const block = `${startMarker}\n\n${table}\n${key}${footnotes.join('')}\n${endMarker}`;
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
