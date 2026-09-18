// npm run inert:check                 report on every open pull request
// npm run inert:check -- --comment    also say so on the ones that are inert
// npm run inert:history               replay the prover over every merge on main
//
// REPORTS ONLY. It merges nothing, has no code path that could, and is not
// given a token that could. #50 lands this in two steps on purpose: the prover's
// verdicts get a public record first, and only then does anyone decide whether
// to hand it merge rights. Step two also needs a merge whitelist entry on main
// that nobody here can set - `GET /branch_protections` answers 403 without repo
// admin - so this half is the whole of what an agent session can do.
//
// The diff is re-derived here with git rather than taken from the API, and this
// script is run from a SCHEDULED job on main (merge-audit.yml), never from a
// `pull_request` trigger. A judge that runs from the checkout of the pull
// request it is judging can be edited by that pull request. Keeping it on main
// also means any change to this file or to inert-core.mjs is, by the prover's own
// rules, `logic` and therefore never inert - it cannot approve its own loosening.

import { execFileSync } from 'node:child_process';
import { classifyChange, verdictLines } from './inert-core.mjs';

const arg = (name) => process.argv.includes(`--${name}`);
const api = process.env.API;
const token = process.env.TOKEN;

const die = (...lines) => { for (const l of lines) console.error(l); process.exit(2); };

const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
// A missing path on one side of the diff is normal (added or deleted file) and
// must not look like a git failure, so this one is allowed to fail.
const gitShow = (rev, path) => {
  try { return git('show', `${rev}:${path}`); } catch { return null; }
};

const LETTER = { A: 'added', D: 'removed', M: 'modified', R: 'renamed', C: 'copied', T: 'modified' };

// `--find-renames` is off: a rename is never inert anyway, and detection would
// only turn one unprovable change into a different unprovable change.
const changedFiles = (base, head) =>
  git('diff', '--no-renames', '--name-status', base, head)
    .split('\n').filter(Boolean)
    .map((line) => {
      const [letter, ...rest] = line.split('\t');
      const path = rest[rest.length - 1];
      const status = LETTER[letter[0]] ?? 'modified';
      return {
        path, status,
        before: status === 'added' ? null : gitShow(base, path),
        after: status === 'removed' ? null : gitShow(head, path),
      };
    });

if (arg('history')) {
  // Day-one validation: the prover judges what actually landed. This is how the
  // figure in #50 is checked rather than remembered.
  //
  // origin/main, and a fetch first. An earlier version read the local `main`,
  // which in a clone that had not fetched silently replayed an old history and
  // reported a smaller number - the same trap merges:check has a comment about.
  git('fetch', '-q', 'origin', 'main');
  const merges = git('rev-list', '--merges', '--first-parent', '--reverse', 'origin/main').split('\n').filter(Boolean);
  let inertCount = 0;
  for (const m of merges) {
    const p1 = git('rev-parse', `${m}^1`).trim();
    const subject = git('log', '-1', '--format=%s', m).trim();
    const result = classifyChange(changedFiles(p1, m));
    if (result.inert) inertCount++;
    const kinds = [...new Set(result.verdicts.map((v) => v.verdict))].sort().join(',');
    console.log(`${result.inert ? 'INERT' : '     '}  ${m.slice(0, 8)}  ${kinds.padEnd(22)} ${subject.slice(0, 64)}`);
  }
  console.log(`\n${merges.length} merges on main, ${inertCount} provably inert`);
  process.exit(0);
}

if (!api) die('API is not set. It is the repo API base, e.g. https://forge/api/v1/repos/owner/repo');
if (!token) die('TOKEN is not set. Reading pulls needs FORGE_PR_TOKEN; the automatic Actions token is answered 404.');

const auth = { Authorization: `token ${token}` };
const get = async (path) => {
  const res = await fetch(`${api}${path}`, { headers: auth });
  if (!res.ok) die(`GET ${path}: ${res.status} ${res.statusText}`);
  return res.json();
};

const pulls = await get('/pulls?state=open&limit=50');
if (!Array.isArray(pulls)) die(`the pulls listing did not answer with a list: ${JSON.stringify(pulls).slice(0, 200)}`);

// origin/main has to be current or every merge-base is wrong. The fetch lives
// here rather than in the workflow for the reason merges:check records: a fetch
// in the shell leaves a local run judging whatever the clone last happened to
// have.
git('fetch', '-q', 'origin', 'main');

let inert = 0, reported = 0;
for (const pr of pulls) {
  const n = pr.number;
  const head = pr.head?.repo?.full_name, base = pr.base?.repo?.full_name;
  console.log(`\n#${n} ${pr.title}`);

  if (pr.draft) { console.log('  skipped: draft'); continue; }
  // A fork's pull request is written by whoever opened it. Inertness is about
  // the diff, but step two would be about trust, so the rule goes in now while
  // it is free rather than after the first fork arrives.
  if (!head || head !== base) { console.log(`  skipped: head is ${head ?? 'unknown'}, not ${base}`); continue; }

  git('fetch', '-q', 'origin', `refs/pull/${n}/head:refs/inert/${n}`, '--force');
  const headSha = git('rev-parse', `refs/inert/${n}`).trim();
  const mergeBase = git('merge-base', 'origin/main', headSha).trim();

  const result = classifyChange(changedFiles(mergeBase, headSha));
  for (const line of verdictLines(result)) console.log(`  ${line}`);

  // Reported for completeness even though nothing here gates on it: step two
  // would, and a green state with no statuses at all is a pull request whose CI
  // never ran, which must not read as passing.
  const status = await get(`/commits/${headSha}/status`);
  const checks = status.statuses?.length ?? 0;
  const green = status.state === 'success' && checks > 0;
  console.log(`  checks: ${status.state} (${checks} reported)${green ? '' : ' - not green'}`);

  if (!result.inert) continue;
  inert++;
  if (!arg('comment')) continue;

  // Once per pull request. A daily schedule would otherwise say the same thing
  // every morning, and a bot that repeats itself gets filtered out along with
  // the thing it was trying to say.
  const MARK = '<!-- inert-check -->';
  const existing = await get(`/issues/${n}/comments`);
  if (existing.some((c) => (c.body ?? '').includes(MARK))) { console.log('  already reported'); continue; }

  const body = [
    MARK,
    '**Provably inert.** Every file in this pull request is either markdown outside the build, or identical to the version on main once comments are removed. Nothing in it can change what this repo does or what the site serves.',
    '',
    ...result.verdicts.map((v) => `- \`${v.path}\` - ${v.verdict}, ${v.why}`),
    '',
    `Checks: ${status.state} (${checks} reported).`,
    '',
    'So this one can be merged on green without reading the diff. Reported by `npm run inert:check` from the daily `merge-audit` job, which re-derives the diff with git from a schedule on main rather than trusting a title. It does not merge anything - see #50 for what step two would need.',
  ].join('\n');

  const res = await fetch(`${api}/issues/${n}/comments`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
  });
  if (res.ok) { reported++; console.log('  reported on the pull request'); }
  // Not fatal, for the same reason retries:check is not: whether FORGE_PR_TOKEN
  // carries issue write is unverified, and a token scope is not a reason to fail
  // a report that has already printed its finding.
  else console.error(`  could not comment on #${n}: ${res.status} ${res.statusText} - the verdict is above`);
}

console.log(`\n${pulls.length} open pull request(s), ${inert} provably inert${arg('comment') ? `, ${reported} newly reported` : ''}`);
// Never fails the job. This is a report, and a pull request needing a person is
// the normal case rather than a fault.
process.exit(0);
