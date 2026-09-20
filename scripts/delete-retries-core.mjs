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
];

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

export const summarise = (results) => ({
  runs: results.length,
  clean: results.filter((r) => r.outcome === 'deleted' && (r.attempts === null || r.attempts === 1)).length,
  retried: results.filter(isRetry),
  failed: results.filter(isFailure),
  unknown: results.filter((r) => r.outcome === 'unknown').length,
});

export const summaryLines = (s, { hours }) => {
  const lines = [`${s.runs} delete run(s) in the last ${hours}h: ${s.clean} clean, ${s.retried.length} needed a retry, ${s.failed.length} gave up`];
  for (const r of s.retried) lines.push(`  RETRIED  ${r.branch}  cleared on attempt ${r.attempts}`);
  for (const r of s.failed) lines.push(`  FAILED   ${r.branch}  ${r.line}`);
  if (s.unknown) lines.push(`  ${s.unknown} run(s) ended on no line this knows - the job's wording may have changed`);
  return lines;
};

// Only the retries go to the tracking issue. Both outcomes now turn the job red
// on their own, so this is not what makes them visible; it is what accumulates
// them on #44, where the rate is the open question. A clean run is not news.
export const tallyComment = (s, { hours }) => {
  if (!s.retried.length) return null;
  const body = [
    `**The retry fired and worked.** ${s.retried.length} delete run(s) in the last ${hours}h needed more than one attempt and cleared:`,
    '',
    ...s.retried.map((r) => `- \`${r.branch}\` - cleared on attempt ${r.attempts}`),
    '',
    'That is the measurement this issue was open for: the forge restored a branch the job had just deleted, the job deleted it again by itself, and it stuck. Each of those runs is also red on purpose - the branch is clean, the writer that put it back is not explained. Reported by `npm run retries:check` from `merge-audit.yml`, which reads the job logs rather than relying on anyone to go looking.',
  ];
  if (s.failed.length) {
    body.push('', `Also in the same window: **${s.failed.length} run(s) gave up**, which is a red job and a different question - the retry did not win there.`);
  }
  return body.join('\n');
};
