// npm run i18n:new -- <code> [--from <code>]
// Scaffolds a language: copies the source language's content files and UI
// catalog under the new code, marks every page as a machine-translated draft,
// and prints the one line to add to src/i18n/locales.js. Translate the copies
// in place; the site builds and links correctly at every stage.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { locales, defaultLocale } from '../src/i18n/locales.js';

const args = process.argv.slice(2);
const code = args[0];
const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : defaultLocale;

if (!code || code.startsWith('-')) {
  console.error('Usage: npm run i18n:new -- <code> [--from <code>]');
  process.exit(1);
}
if (locales.some((l) => l.code === code)) {
  console.error(`${code} is already in src/i18n/locales.js`);
  process.exit(1);
}
if (!existsSync(`src/content/pages/${from}`)) {
  console.error(`No content for source language "${from}"`);
  process.exit(1);
}

const target = `src/content/pages/${code}`;
mkdirSync(target, { recursive: true });

for (const file of readdirSync(`src/content/pages/${from}`).filter((f) => f.endsWith('.md'))) {
  const source = readFileSync(`src/content/pages/${from}/${file}`, 'utf8');
  const marked = source.replace(/^---\n/, '---\nmachineTranslated: true\n');
  writeFileSync(`${target}/${file}`, marked);
}

// The catalog is copied, not translated, so it starts flagged like the pages.
const catalog = JSON.parse(readFileSync(`src/i18n/ui/${from}.json`, 'utf8'));
writeFileSync(
  `src/i18n/ui/${code}.json`,
  `${JSON.stringify({ _meta: { machineTranslated: true }, ...catalog }, null, 2)}\n`
);

console.log(`Copied ${from} -> ${code}:`);
console.log(`  ${target}/*.md   (marked as drafts awaiting review)`);
console.log(`  src/i18n/ui/${code}.json   (marked as a draft awaiting review)`);
console.log('\nAdd to the list in src/i18n/locales.js:');
console.log(
  `  { code: '${code}', endonym: 'NAME IN ITS OWN LANGUAGE', intl: 'BCP47', og: 'xx_XX', dir: 'ltr' },`
);
console.log('\nThen translate the copied files. Nothing else needs changing.');
