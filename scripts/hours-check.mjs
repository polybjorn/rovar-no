// npm run hours:check
//
// Reads Nærbutikken Røvær's opening hours from narbutikken.no and fails when
// they differ, day by day, from the hours rows the explore page prints, which
// its "open now" line runs on. The site cannot read theirs live: narbutikken.no
// sends no CORS header, and the page's CSP allows no such fetch. So the
// hours stay ours, and this says when they go stale. Run weekly from
// .forgejo/workflows/link-check.yml, which files an issue on the first
// finding.

import { facts } from '../src/data/facts.js';
import { readFileSync } from 'node:fs';
import { storeHours, printedHours, hoursDrift } from './hours-check-core.mjs';
import { fileReminder } from './file-reminder.mjs';

const url = facts.narbutikkenUrl;
const page = new URL('../src/content/pages/no/explore.md', import.meta.url);
const heading = 'Nærbutikken Røvær';
const ours = printedHours(readFileSync(page, 'utf8'), heading, 'no');
if (!ours) {
  console.error(`hours:check: no hours rows under "${heading}" in ${page.pathname}; nothing to compare.`);
  process.exit(1);
}

let html;
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  html = await res.text();
} catch (err) {
  // Their site being down says nothing about their hours; link-check reports
  // a dead page already.
  console.error(`hours:check: could not fetch ${url} (${err.message}); not checked.`);
  process.exit(0);
}

const theirs = storeHours(html);
if (!theirs) {
  console.error(`hours:check: ${url} no longer carries opening hours this can read.`);
  await fileReminder({
    marker: 'hours-check',
    title: "Check Nærbutikken's opening hours by hand",
    body: `hours:check could not find opening hours in ${url}: the page no longer carries them as schema.org data, so the weekly check is blind. Compare the hours on that page with the Nærbutikken rows in the explore page, then fix \`scripts/hours-check-core.mjs\` for the new page.`,
  });
  process.exit(1);
}

const drift = hoursDrift(theirs, ours);
for (const [day, hours] of Object.entries(theirs)) console.log(`${day.padEnd(9)}  ${hours.join(' - ')}`);
if (!drift.length) {
  console.log('\nMatches the hours the explore page prints, every day.');
  process.exit(0);
}

const show = (h) => (h ? h.join(' - ') : 'closed');
const lines = drift.map((d) => `- ${d.day}: theirs ${show(d.theirs)}, ours ${show(d.ours)}`);
console.error(`\nhours:check: Nærbutikken's hours differ from the explore page:\n${lines.join('\n')}`);
await fileReminder({
  marker: 'hours-check',
  title: "Update Nærbutikken's opening hours",
  body: [
    `${url} now gives different opening hours from the Nærbutikken rows in the explore page (\`src/data/season.js\` holds the times), so the site prints old hours and its "open now" line follows them.`,
    '',
    ...lines,
    '',
    'If one day now differs from the rest, give it a row of its own, with a time in `season.js` and a label in each language (`Mandag til lørdag`, `Søndag`); the open-now line follows the rows. `npm run hours:check` shows what is left.',
  ].join('\n'),
});
process.exit(1);
