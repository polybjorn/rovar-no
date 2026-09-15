// npm run sweep:check                     did the branch sweep run in the last 48h
// npm run sweep:check -- --hours 72       a wider window
// npm run sweep:check -- --job sweep --workflow delete-merged-branch.yml
//
// Fails when nothing has swept merged branches recently. Run from
// .forgejo/workflows/merge-audit.yml, which already runs daily for a related
// reason: that job refuses to let a lost merge be silent, this step refuses to
// let a dead timer be silent. Both are watchdogs over the same forge, and
// folding the second into the first means it needs no schedule of its own.
//
// Why it is needed at all: an event-driven cleanup cannot fail loudly when the
// event never arrives, and neither can a cron that stops firing. The sweep
// closes the first gap; without this, it reopens the same gap one layer up.
//
// Needs API and TOKEN in the environment. TOKEN must be able to read the repo's
// Actions listing; the automatic Actions token is not enough on this forge, the
// same wall merges:check and deps-update hit, so this uses FORGE_PR_TOKEN too.

import { collectTasks, verdict, summaryLines } from './sweep-freshness-core.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const windowHours = Number(arg('hours', '48'));
const job = arg('job', 'sweep');
const workflow = arg('workflow', 'delete-merged-branch.yml');
const api = process.env.API;
const token = process.env.TOKEN;

const die = (...lines) => {
  for (const l of lines) console.error(l);
  process.exit(2);
};

if (!Number.isFinite(windowHours) || windowHours <= 0) die(`--hours must be a positive number, got ${arg('hours', '48')}`);
if (!api) die('API is not set. It is the repo API base, e.g. https://forge/api/v1/repos/owner/repo');
if (!token) {
  die(
    'TOKEN is not set. It needs read access to the Actions listing; the automatic',
    'Actions token is not enough on this forge, so a real token is required.'
  );
}

const LIMIT = 50;
const since = Date.now() - windowHours * 3600_000;

const getPage = async (page) => {
  const url = `${api}/actions/tasks?limit=${LIMIT}&page=${page}`;
  const res = await fetch(url, { headers: { Authorization: `token ${token}` } });
  if (!res.ok) die(`could not list action tasks: ${res.status} ${res.statusText}`);
  const body = await res.json();
  const list = body?.workflow_runs;
  if (!Array.isArray(list)) die(`the tasks listing did not answer with a list: ${JSON.stringify(body).slice(0, 200)}`);
  return list;
};

const { tasks, complete, pages } = await collectTasks(getPage, { limit: LIMIT, maxPages: 10, since });
if (!complete) {
  // Not a silent shrug. Stopping early is the one way this check can report
  // "no sweep found" about a sweep it simply never reached, which would turn a
  // working backstop into a red job and get the whole thing muted.
  die(
    `stopped after ${pages} pages of action tasks without reaching the ${windowHours}h boundary.`,
    'Raise maxPages in this script, or narrow --hours. Reporting a missing sweep would be a guess.'
  );
}

const result = verdict(tasks, { windowHours, job, workflow });
for (const line of summaryLines(result)) console.log(line);
process.exit(result.ok ? 0 : 1);
