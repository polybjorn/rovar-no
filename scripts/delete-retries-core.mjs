// The parts of the delete-retry tally that touch no network, kept separate so
// test/delete-retries.test.mjs can cover them. Same split as
// merged-prs-core.mjs, link-check-core.mjs and sweep-freshness-core.mjs.
//
// The question this answers: how often did the forge put back a branch we had
// just deleted, and did deleting it again clear it?
//
// This was written for a job shape that no longer exists, and the reason it
// survives is not the reason it was added. #45 made a restored ref end GREEN,
// so a working retry was invisible and this was the only thing that reported
// it. #44 reversed that on 2026-09-18: a run that needed more than one attempt
// now exits non-zero, so the event is on the tick again and nothing here is
// load-bearing for visibility.
//
// What a per-run tick still cannot say is HOW OFTEN, and that is the number #44
// is open for. A red tick is one event; this counts them over a window and puts
// the count where the investigation is reading. So it is now a tally rather than
// a watchdog, which is also why it still never fails the job.
//
// NO RATE IS WRITTEN IN THIS FILE, deliberately. The version of this comment
// that carried one ("two merges in four, and not measured since") was stale the
// same day it merged, because the repo kept merging. A tally that states its own
// answer in a tracked file is grading itself on data it cannot see. The answer
// is whatever `npm run retries:check` prints today.

// Runner logs carry an RFC3339 timestamp per line. Strip it so the patterns
// below can anchor, rather than each one carrying a `.*` that would also make
// them match mid-line - which matters because git's own push output contains
// the string "[deleted]" and must not be read as the job's verdict.
export const stripStamp = (line) => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, '');

// Every line the delete job can end on, newest shape first. Four generations of
// this workflow are still represented in the logs this reads, and the third
// entry is the reason each pattern says explicitly whether it captures an
// attempt count:
//
//   #45-era   deleted herd/x (2 attempt(s))     <- 2 is an attempt count
//   #38-era   deleted herd/x                    <- no count recorded
//   #8-era    deleted herd/x (204)              <- 204 is an HTTP STATUS
//
// A pattern loose enough to read a parenthesised number as the count would
// report the last of those as a retry that cleared on attempt 204. So the
// capture group is named per pattern rather than inferred from position, and
// the pre-#45 shapes report attempts: null. "Not recorded" and "one attempt"
// are different facts, and conflating them would overstate how well the retry
// is doing - which is the one thing this tally exists to measure honestly.
const VERDICTS = [
  [/^deleted (\S+) \((\d+) attempt\(s\)\)$/, 'deleted', 2],
  [/^deleted (\S+) \(\d+\)$/, 'deleted', null],
  [/^deleted (\S+)$/, 'deleted', null],
  // The current job's restore verdict. It does NOT delete the ref again, so
  // there is no attempt count to capture and no "gone now" to report: the
  // branch is still on the remote on purpose, because a second delete erases
  // the reflog that is the only evidence separating #44's two faults.
  [/^(\S+) KEPT as a specimen: /, 'preserved', null],
  [/^(\S+) SURVIVED (\d+) delete attempts /, 'survived', 2],
  [/^(\S+) SURVIVED the delete /, 'survived', null],
  [/^(\S+) came back after the delete had settled \((\d+) attempt\(s\)\)$/, 'returned', 2],
  [/^(\S+) came back within 15s /, 'returned', null],
  [/^(\S+) is already gone$/, 'already-gone', null],
  // Not a verdict about the branch at all - the job refused to reach one
  // because `git ls-remote` could not answer, and a read that failed is not a
  // ref that is gone. It is named here so the daily tally reports it as what
  // it is instead of "the job's wording may have changed", which is what an
  // unknown outcome says and would send the next reader looking for an edit
  // that never happened.
  [/^git ls-remote could not read the remote, so nothing here can say whether (\S+) is gone$/, 'unreadable', null],
  [/^PR closed without merging, leaving (\S+)$/, 'not-merged', null],
  [/^(\S+) is not ours, leaving it$/, 'not-ours', null],
  // The same refusal in the action's wording, which is not the one above. The
  // job-level `if:` in delete-merged-branch.yml means this repo cannot reach
  // it, so it had diverged unnoticed since #72 and only turned up when
  // scripts/verdict-contract-core.mjs went looking - which is the argument for
  // that file in one line.
  [/^refusing: (\S+) is not under \S+, so this action will not touch it$/, 'not-ours', null],
];

// Every outcome a pattern above can produce, plus the one classifyLog invents
// when nothing matched. Exported for test/delete-retries.test.mjs, which
// asserts each of them lands in exactly one bucket below - so adding a verdict
// here and forgetting the bucket fails a test instead of quietly shrinking the
// numbers in the daily summary.
export const OUTCOMES = [...new Set(VERDICTS.map(([, outcome]) => outcome)), 'unknown'];

export const classifyLog = (text) => {
  for (const raw of String(text).split('\n')) {
    const line = stripStamp(raw).trim();
    for (const [re, outcome, countGroup] of VERDICTS) {
      const m = line.match(re);
      if (!m) continue;
      const attempts = countGroup === null ? null : Number(m[countGroup]);
      return { outcome, branch: m[1], attempts, line };
    }
  }
  return { outcome: 'unknown', branch: null, attempts: null, line: null };
};

// A run is only interesting if the forge actually interfered: either the retry
// was needed (attempts > 1) or the job gave up. Everything else is a normal
// merge and saying so daily would be noise of a different kind.
export const isRetry = (r) => r.outcome === 'deleted' && r.attempts !== null && r.attempts > 1;
export const isFailure = (r) => r.outcome === 'survived' || r.outcome === 'returned';

// Its own bucket, and the one this tally now exists to count. A preserved run
// is not a failure - nothing went wrong that the job could have done better,
// and the branch is deliberately still there. It is the event #44 is open for,
// and unlike every other outcome here it has a DEADLINE: the specimen is
// readable until the sweep expires it.
export const isPreserved = (r) => r.outcome === 'preserved';

// Runs where the job correctly did nothing: the branch was gone before it
// started, the PR was closed unmerged, the branch was not ours. Nothing to
// report about any of them individually, but they are still runs, and the
// summary has to say so - see the accounting note on summaryLines.
const QUIET = new Set(['already-gone', 'not-merged', 'not-ours']);
export const isQuiet = (r) => QUIET.has(r.outcome);

// Its own bucket rather than a quiet one: the job went RED because git could
// not read the remote, so nothing was deleted and nothing was verified. That
// is not a delete failure - the retry never ran - and it is not nothing.
export const isUnreadable = (r) => r.outcome === 'unreadable';

export const summarise = (results) => {
  const s = {
    runs: results.length,
    clean: results.filter((r) => r.outcome === 'deleted' && (r.attempts === null || r.attempts === 1)).length,
    retried: results.filter(isRetry),
    preserved: results.filter(isPreserved),
    failed: results.filter(isFailure),
    unreadable: results.filter(isUnreadable),
    quiet: results.filter(isQuiet).length,
    unknown: results.filter((r) => r.outcome === 'unknown').length,
  };
  s.unaccounted = s.runs - s.clean - s.retried.length - s.preserved.length - s.failed.length - s.unreadable.length - s.quiet - s.unknown;
  return s;
};

// THE BUCKETS HAVE TO ADD UP TO THE TOTAL, and until #60 they did not: the
// first line printed a count of runs and three numbers that fell short of it,
// with nothing saying where the rest went. A window of five runs - one clean
// delete, two already gone, one unreadable remote, one PR closed unmerged -
// read as "5 delete run(s): 1 clean, 0 needed a retry, 0 gave up", so four
// runs where the job had nothing to do were indistinguishable from four runs
// that never happened. That is the same confusion the delete job's own
// always-print-a-summary rule exists to prevent, one layer up.
//
// So every outcome lands in a bucket, and `unaccounted` catches the next
// verdict added without one - it should always be zero, the test asserts it
// over OUTCOMES, and if it is ever not, the line says so rather than the
// numbers quietly shrinking.
export const summaryLines = (s, { hours }) => {
  const lines = [`${s.runs} delete run(s) in the last ${hours}h: ${s.clean} clean, ${s.preserved.length} kept as a specimen, ${s.retried.length} needed a retry, ${s.failed.length} gave up`];
  for (const r of s.preserved) lines.push(`  SPECIMEN ${r.branch}  ${r.line}`);
  for (const r of s.retried) lines.push(`  RETRIED  ${r.branch}  cleared on attempt ${r.attempts}`);
  for (const r of s.failed) lines.push(`  FAILED   ${r.branch}  ${r.line}`);
  for (const r of s.unreadable) lines.push(`  UNREADABLE  ${r.branch}  the job could not reach the remote, so it deleted and verified nothing`);
  if (s.quiet) lines.push(`  ${s.quiet} run(s) had nothing to delete`);
  if (s.unknown) lines.push(`  ${s.unknown} run(s) ended on no line this knows - the job's wording may have changed`);
  if (s.unaccounted) lines.push(`  ${s.unaccounted} run(s) in no bucket at all - an outcome was added to this parser without one`);
  return lines;
};

// What goes to the tracking issue, and what deliberately does not.
//
// THIS IS THE RECORD, NOT THE ALARM, and the schedule is why. This runs from
// merge-audit.yml at 05:13 and the sweep runs at 04:53, so a specimen that
// appeared overnight has already been expired or swept by the time anything
// here could mention it - twenty minutes late, every time, by construction.
// Moving the cron would only change which twenty minutes. So the delete job
// comments on the issue itself the moment it keeps a specimen, and this says
// what happened over a window, in the past tense it has actually earned.
//
// A clean run is not news and never appears here.
export const tallyComment = (s, { hours }) => {
  if (!s.preserved.length && !s.retried.length) return null;
  const body = [];

  if (s.preserved.length) {
    body.push(
      `**${s.preserved.length} delete run(s) in the last ${hours}h kept a branch as a specimen.** The forge put back a ref after a delete git accepted, and the job left it there rather than deleting it again.`,
      '',
      ...s.preserved.map((r) => `- \`${r.branch}\` - ${r.line}`),
      '',
      'Each of those is red on purpose and each posted its own comment here when it happened, with the host-side read to run. This line is the tally rather than the notice: by the time it is written the sweep has usually been past. If one of these was never read, the reflog is gone and that occurrence is spent - the rate is still worth having, the specimen is not recoverable.',
    );
  }

  if (s.retried.length) {
    if (body.length) body.push('');
    body.push(
      `**${s.retried.length} run(s) in the same window needed more than one attempt.** Those are from the convergence loop, which this repo removed: a second delete erased the reflog about five seconds after the restore, which is the only evidence that tells this issue's two faults apart.`,
      '',
      ...s.retried.map((r) => `- \`${r.branch}\` - cleared on attempt ${r.attempts}`),
      '',
      'A run in this bucket today means an older job shape is still live somewhere, because the current one never makes a second attempt.',
    );
  }

  if (s.failed.length) {
    body.push('', `Also in the window: **${s.failed.length} run(s) gave up**, which is a red job and an older shape again.`);
  }

  return body.join('\n');
};
