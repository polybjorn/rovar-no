// npm run retries:check                    look at the last 26h of delete runs
// npm run retries:check -- --hours 72      a wider window
// npm run retries:check -- --issue 44      also comment the retries on an issue
//
// Reads the delete job's own logs and reports how often the forge restored a
// branch and the job's retry cleared it. Run from merge-audit.yml, which
// already runs daily for a neighbouring reason: that job refuses to let a lost
// merge be silent, this step refuses to let a WORKING fix be silent.
//
// That asymmetry is the whole point. After #45 a failed retry turns the job red
// and somebody sees it; a successful retry ends green and looks identical to a
// merge where the forge behaved. The one outcome #44 is waiting to observe was
// the one nothing reported.
//
// Needs API and TOKEN. The automatic Actions token cannot read this repo's
// pulls and is not used anywhere in merge-audit; this uses FORGE_PR_TOKEN like
// its neighbours. Commenting additionally needs issue write on that token,
// which is NOT verified - see the --issue handling below, which degrades to
// printing rather than failing the job if the POST is refused.

import { classifyLog, summarise, summaryLines, tallyComment } from './delete-retries-core.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const hours = Number(arg('hours', '26'));
const workflow = arg('workflow', 'delete-merged-branch.yml');
const job = arg('job', 'delete');
const issue = arg('issue', process.env.TALLY_ISSUE || '');
const api = process.env.API;
const token = process.env.TOKEN;

const die = (...lines) => {
  for (const l of lines) console.error(l);
  process.exit(2);
};

if (!Number.isFinite(hours) || hours <= 0) die(`--hours must be a positive number, got ${arg('hours', '26')}`);
if (!api) die('API is not set. It is the repo API base, e.g. https://forge/api/v1/repos/owner/repo');
if (!token) die('TOKEN is not set. It needs read access to the Actions listing.');

const auth = { Authorization: `token ${token}` };
const since = Date.now() - hours * 3600_000;

const get = async (path) => {
  const res = await fetch(`${api}${path}`, { headers: auth });
  if (!res.ok) die(`GET ${path}: ${res.status} ${res.statusText}`);
  return res;
};

// The runs listing embeds the whole repository object and the push payload in
// every entry, so it is heavy. A small page size is deliberate: this only ever
// needs a day, and 26h against a daily schedule leaves two hours of overlap so
// a late run is counted once rather than missed.
const LIMIT = 20;
const runs = [];
let complete = false;
for (let page = 1; page <= 10; page++) {
  const batch = await (await get(`/actions/runs?limit=${LIMIT}&page=${page}`)).json();
  const list = batch?.workflow_runs;
  if (!Array.isArray(list)) die(`the runs listing did not answer with a list: ${JSON.stringify(batch).slice(0, 200)}`);
  runs.push(...list.filter((r) => r.workflow_id === workflow));
  const oldest = list[list.length - 1];
  if (list.length < LIMIT || (oldest && Date.parse(oldest.created) < since)) { complete = true; break; }
}
if (!complete) {
  // Same reasoning as merges:check. Stopping early is the one way this reports
  // "no retries" about runs it never looked at, which would quietly turn a
  // working watchdog into a decorative one.
  die(
    `stopped after 10 pages of action runs without reaching the ${hours}h boundary.`,
    'Raise the page bound in this script, or narrow --hours. Reporting nothing found would be a guess.'
  );
}

const recent = runs.filter((r) => Date.parse(r.created) >= since);
const results = [];
for (const run of recent) {
  const jobs = await (await get(`/actions/runs/${run.id}/jobs`)).json();
  // A skipped job carries task_id 0 and has no log. The sweep job in the same
  // workflow is skipped on every merge, and the delete job is skipped whenever
  // its `if:` says the PR was not merged or the branch is not ours.
  const j = (jobs.jobs || jobs).find((x) => x.name === job && x.task_id);
  if (!j) continue;
  const text = await (await get(`/actions/jobs/${j.id}/logs`)).text();
  results.push({ run: run.id, ...classifyLog(text) });
}

const summary = summarise(results);
for (const line of summaryLines(summary, { hours })) console.log(line);

// The tracking-issue comment is scaffolding for #44 and is meant to be removed
// with it, which is why the number is passed in rather than baked into the
// core. Everything above this line is the part worth keeping.
const comment = tallyComment(summary, { hours });
if (issue && comment) {
  const res = await fetch(`${api}/issues/${issue}/comments`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: comment }),
  });
  if (res.ok) console.log(`reported ${summary.retried.length} retry(ies) on issue #${issue}`);
  // Deliberately not fatal. Whether FORGE_PR_TOKEN carries issue write is
  // unverified, and a token scope is not a reason to fail an audit that has
  // already printed its finding to the log.
  else console.error(`could not comment on #${issue}: ${res.status} ${res.statusText} - the tally is above`);
}

// Never fails the job. A retry that worked is good news, and a retry that did
// not already turned the delete job itself red.
process.exit(0);
