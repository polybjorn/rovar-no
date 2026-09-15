// The parts of the delete-retry tally that touch no network, kept separate so
// test/delete-retries.test.mjs can cover them. Same split as
// merged-prs-core.mjs, link-check-core.mjs and sweep-freshness-core.mjs.
//
// The question this answers: when the forge restored a branch we had just
// deleted, did the job's retry clear it? #45 made the job delete again instead
// of going red, and that change had a hole in it - the only outcome that
// surfaced itself was the bad one. A retry that fails turns the job red and
// somebody sees it; a retry that WORKS looks exactly like a merge where nothing
// happened, because both end green. So the thing #44 is waiting to observe was
// the one thing nothing reported.
//
// That is the same fault as a lost merge being silent (merge-audit.yml) and a
// dead sweep timer looking like nothing to do (sweep-freshness-core.mjs). This
// is the third instance of it in this repo, which is why it reads the logs
// rather than trusting anyone to remember to.

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

// Only the retries go to the tracking issue. A failure already turns the job
// red, which is its own report; a clean run is not news.
export const tallyComment = (s, { hours }) => {
  if (!s.retried.length) return null;
  const body = [
    `**The retry fired and worked.** ${s.retried.length} delete run(s) in the last ${hours}h needed more than one attempt and cleared:`,
    '',
    ...s.retried.map((r) => `- \`${r.branch}\` - cleared on attempt ${r.attempts}`),
    '',
    'That is the measurement this issue was open for: the forge restored a branch the job had just deleted, the job deleted it again by itself, and it stuck. Reported by `npm run retries:check` from `merge-audit.yml`, which reads the job logs rather than relying on anyone to go looking.',
  ];
  if (s.failed.length) {
    body.push('', `Also in the same window: **${s.failed.length} run(s) gave up**, which is a red job and a different question - the retry did not win there.`);
  }
  return body.join('\n');
};
