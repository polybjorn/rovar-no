// npm run hours:check
//
// Reads Nærbutikken Røvær's opening hours from narbutikken.no and fails when
// they differ from src/data/season.js, which is what the site prints and what
// its "open now" line runs on. The site cannot read theirs live: narbutikken.no
// sends no CORS header, and the page's CSP allows no such fetch. So the
// hours stay ours, and this says when they go stale. Run weekly from
// .forgejo/workflows/link-check.yml, which files an issue on the first
// finding.

import { facts } from '../src/data/facts.js';
import { season } from '../src/data/season.js';
import { storeHours, hoursDrift } from './hours-check-core.mjs';
import { fileReminder } from './file-reminder.mjs';

const url = facts.narbutikkenUrl;
const ours = season.narbutikkenHours;

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
    body: `hours:check could not find opening hours in ${url}: the page no longer carries them as schema.org data, so the weekly check is blind. Compare the hours on that page with \`narbutikkenHours\` in \`src/data/season.js\`, then fix \`scripts/hours-check-core.mjs\` for the new page.`,
  });
  process.exit(1);
}

const drift = hoursDrift(theirs, ours);
for (const [day, hours] of Object.entries(theirs)) console.log(`${day.padEnd(9)}  ${hours.join(' - ')}`);
if (!drift.length) {
  console.log(`\nMatches narbutikkenHours (${ours.join(' - ')}).`);
  process.exit(0);
}

const lines = drift.map((d) => `- ${d.day}: theirs ${d.theirs ? d.theirs.join(' - ') : 'closed'}, ours ${d.ours.join(' - ')}`);
console.error(`\nhours:check: Nærbutikken's hours differ from src/data/season.js:\n${lines.join('\n')}`);
await fileReminder({
  marker: 'hours-check',
  title: "Update Nærbutikken's opening hours",
  body: [
    `${url} now gives different opening hours from \`narbutikkenHours\` in \`src/data/season.js\`, so the site prints old hours and its "open now" line follows them.`,
    '',
    ...lines,
    '',
    'If the days differ too, the row in the explore pages needs a new label (one per language). `npm run hours:check` shows what is left.',
  ].join('\n'),
});
process.exit(1);
