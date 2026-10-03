// npm run season:check
//
// Lists every season date in src/data/season.js with whether it is still
// running, over, or stale, and fails when one is stale: last year's dates
// with a new season coming (scripts/season-check-core.mjs says when that
// starts). Run weekly from .forgejo/workflows/link-check.yml, which files an
// issue on the first stale run as the reminder to ask the places for this
// year's hours.

import { readdirSync, readFileSync } from 'node:fs';

import { seasonLastDay } from '../src/i18n/season-format.js';
import { toOsloDate } from '../src/scripts/departures-core.js';
import { seasonStatus } from './season-check-core.mjs';

// Which places each date is printed under, read from the Norwegian pages'
// headings, so the list says "Røvær Sjøhus" rather than only "autumn".
const dir = new URL('../src/content/pages/no/', import.meta.url);
const places = {};
for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
  let heading = file;
  for (const line of readFileSync(new URL(file, dir), 'utf8').split('\n')) {
    const h = line.match(/^#{2,3} (.+)/);
    if (h) heading = h[1].trim();
    for (const [, key] of line.matchAll(/\{\{(\w+)\}\}/g)) {
      if (key in seasonLastDay) (places[key] ??= new Set()).add(heading);
    }
  }
}

const today = process.argv[2] ?? toOsloDate(new Date());
const rows = seasonStatus(seasonLastDay, today);

const width = Math.max(...rows.map((r) => r.key.length));
for (const { key, lastDay, state } of rows) {
  const where = [...(places[key] ?? [])].join(', ');
  console.log(`${key.padEnd(width)}  until ${lastDay}  ${state.padEnd(7)}  ${where}`);
}

const stale = rows.filter((r) => r.state === 'stale');
if (stale.length) {
  console.error(`\nseason:check: ${stale.map((r) => r.key).join(', ')} still hold last year's dates.`);
  console.error('Update src/data/season.js with this year\'s hours (README, "Updating dates and hours").');
  await fileIssue(stale);
  process.exit(1);
}

// The failing job is a push that the next green run on the repo clears, so the
// reminder that lasts is an issue. One open at a time, found by its marker, so
// a weekly run against the same stale dates does not file a second. Needs API
// and ISSUE_TOKEN (the Actions token; FORGE_PR_TOKEN is 403 on /issues, #54).
// Not fatal: the job has already failed with the finding printed above.
async function fileIssue(stale) {
  const api = process.env.API;
  const token = process.env.ISSUE_TOKEN;
  if (!api || !token) return;
  const MARK = '<!-- season-check -->';
  const headers = { Authorization: `token ${token}`, 'Content-Type': 'application/json' };
  try {
    const open = await fetch(`${api}/issues?state=open&type=issues&limit=50`, { headers });
    if (!open.ok) throw new Error(`GET /issues: ${open.status}`);
    const existing = (await open.json()).find((i) => i.body?.includes(MARK));
    if (existing) {
      console.error(`already open as #${existing.number}`);
      return;
    }
    const list = stale.map((r) => `- \`${r.key}\` (until ${r.lastDay}): ${[...(places[r.key] ?? [])].join(', ')}`);
    const body = [
      `Last year's season dates are still on the site, and this year's season is coming. Ask the places for this year's hours and update \`src/data/season.js\`; where each one publishes is noted at the top of that file.`,
      '',
      ...list,
      '',
      'The PR that updates them closes this. `npm run season:check` shows what is left.',
      MARK,
    ].join('\n');
    const res = await fetch(`${api}/issues`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'Update the season dates for this year', body }),
    });
    if (!res.ok) throw new Error(`POST /issues: ${res.status}`);
    console.error(`filed #${(await res.json()).number}`);
  } catch (err) {
    console.error(`could not file the reminder issue (${err.message}); the finding is above`);
  }
}
