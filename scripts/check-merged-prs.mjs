// npm run merges:check                 audit the last 7 days against origin/main
// npm run merges:check -- --days 30    a wider window
// npm run merges:check -- --ref main   compare against a local ref instead
//
// Fails when a pull request the forge reports as merged is not actually on the
// branch. Run from .forgejo/workflows/merge-audit.yml on a daily schedule, not
// on a merge: the failure is a ref being rolled back some time AFTER the merge
// reports success, so a check that ran as part of the merge would be asking too
// early.
//
// It does not prevent the loss and does not explain it - that investigation is
// nixfleet #172 - it only refuses to let the loss be silent. On lokalverket-no
// both occurrences were caught by a person reading `git log` and happening to
// know which merge commit to expect. This is that habit, made not-a-habit.
//
// Needs API and TOKEN in the environment. The automatic Actions token is not
// enough: Forgejo answers 404 "Can not read pulls" for it, which is the same
// wall deps-update.yml hits, so this uses FORGE_PR_TOKEN too.

import { execFileSync } from 'node:child_process';
import { collectClosed, mergedWithin, classify, summaryLines, remoteRefParts } from './merged-prs-core.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const days = Number(arg('days', '7'));
const ref = arg('ref', 'origin/main');
const api = process.env.API;
const token = process.env.TOKEN;

const die = (...lines) => {
  for (const l of lines) console.error(l);
  process.exit(2);
};

if (!Number.isFinite(days) || days <= 0) die(`--days must be a positive number, got ${arg('days', '7')}`);
if (!api) die('API is not set. It is the repo API base, e.g. https://forge/api/v1/repos/owner/repo');
if (!token) {
  die(
    'TOKEN is not set. It needs read access to pulls; the automatic Actions token',
    'is answered 404 "Can not read pulls" on this forge, so a real token is required.'
  );
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const gitOk = (...args) => {
  try {
    execFileSync('git', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

// A shallow clone cannot answer this question and does not fail loudly when
// asked: merge commits fetch fine, but the branch's history is truncated, so
// --is-ancestor says no for nearly all of them. lokalverket-no measured a
// --depth 1 clone of a repo with zero real orphans reporting six of twelve as
// orphaned. A watchdog that cries wolf gets muted, and then the real one is
// invisible too - so refuse rather than guess. The workflow also sets
// fetch-depth: 0; this is what makes getting that wrong loud.
if (git('rev-parse', '--is-shallow-repository') === 'true') {
  die(
    'this is a shallow clone, so reachability cannot be decided here.',
    'Nearly every merge would be reported as orphaned.',
    'Use a full clone, or in CI pass depth: 0 to the checkout action.'
  );
}

// A stale remote-tracking ref is the second way this tool manufactures false
// orphans, and the convincing one: everything merged since the last fetch is
// genuinely not an ancestor of the copy on disk, so the output is one or two
// plausible orphans rather than an obviously broken page of them. Measured on a
// twenty-minute-old full clone of this repo: PRs #31 and #33, both correctly
// merged, both reported ORPHANED with correct parents.
//
// The workflow used to do this fetch in the shell before calling the script.
// That left every other way of running it - a local `npm run merges:check`
// most of all - trusting whatever the clone last happened to fetch. It belongs
// here, where nobody can forget it.
const remotes = git('remote').split('\n').filter(Boolean);
const parts = remoteRefParts(ref, remotes);
if (parts) {
  if (!gitOk('fetch', '--quiet', parts.remote, parts.branch)) {
    die(
      `could not fetch ${parts.branch} from ${parts.remote}, so ${ref} may be stale.`,
      'Judging reachability against a stale ref reports correctly merged pull requests',
      'as orphaned, so this refuses rather than guessing.'
    );
  }
} else {
  console.log(`note: ${ref} is not a remote-tracking ref, so it is read as it stands`);
}

const LIMIT = 50;
const since = Date.now() - days * 86400_000;

const getPage = async (page) => {
  const url = `${api}/pulls?state=closed&limit=${LIMIT}&page=${page}&sort=recentupdate`;
  const res = await fetch(url, { headers: { Authorization: `token ${token}` } });
  if (!res.ok) die(`could not list pulls: ${res.status} ${res.statusText}`);
  const body = await res.json();
  if (!Array.isArray(body)) die(`the pulls listing did not answer with a list: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
};

const { pulls, complete, pages } = await collectClosed(getPage, { limit: LIMIT, maxPages: 10, since });
if (!complete) {
  // Not a silent shrug: stopping early is the one way this check can report
  // "all reachable" about pull requests it never looked at.
  die(
    `stopped after ${pages} pages of closed pull requests without reaching the ${days}-day boundary.`,
    'Raise maxPages in this script, or narrow --days. Reporting nothing found would be a lie.'
  );
}

const merged = mergedWithin(pulls, days);
if (!merged.length) {
  console.log(`no pull requests merged in the last ${days} days`);
  process.exit(0);
}

const resolve = (sha) => {
  // An orphaned merge commit is unreachable, so a normal clone will not have
  // fetched it. Ask for it directly before concluding anything.
  if (!gitOk('cat-file', '-e', `${sha}^{commit}`) && !gitOk('fetch', '--quiet', 'origin', sha)) return 'missing';
  return gitOk('merge-base', '--is-ancestor', sha, ref) ? 'reachable' : 'unreachable';
};

const result = classify(merged, resolve);
const parentsOf = (sha) => (gitOk('cat-file', '-e', `${sha}^{commit}`) ? git('log', '-1', '--format=%p', sha) : '(unknown)');

for (const line of summaryLines(result, { ref, days, parentsOf })) console.log(line);
process.exit(result.ok ? 0 : 1);
