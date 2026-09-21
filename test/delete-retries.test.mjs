import test from 'node:test';
import assert from 'node:assert/strict';
import { stripStamp, classifyLog, isRetry, isFailure, isPreserved, summarise, summaryLines, tallyComment, OUTCOMES } from '../scripts/delete-retries-core.mjs';

const stamped = (...lines) => lines.map((l, i) => `2026-09-15T10:17:2${i}.6558431Z ${l}`).join('\n');

test('the runner timestamp is stripped, and a bare line survives', () => {
  assert.equal(stripStamp('2026-09-15T10:17:21.6558431Z deleted herd/x (1 attempt(s))'), 'deleted herd/x (1 attempt(s))');
  assert.equal(stripStamp('deleted herd/x'), 'deleted herd/x');
});

// Every one of these is a real line taken from a real job log in this repo,
// not an invented shape. Runs 1289, 1266, 1249, 1243 and 1227.
test('the post-#45 success line carries the attempt count', () => {
  const r = classifyLog(stamped('To https://git-ci.pebblecove.xyz:8447/bjorn/rovar-no.git', 'deleted herd/converge-on-delete (1 attempt(s))'));
  assert.equal(r.outcome, 'deleted');
  assert.equal(r.branch, 'herd/converge-on-delete');
  assert.equal(r.attempts, 1);
});

test('a pre-#45 success reports no count rather than pretending it was one', () => {
  const r = classifyLog(stamped('deleted herd/sweep-merged-branches'));
  assert.equal(r.outcome, 'deleted');
  assert.equal(r.attempts, null);
  assert.equal(isRetry(r), false);
});

test('a retry that cleared is a retry', () => {
  const r = classifyLog(stamped('attempt 1: herd/x is back 5s after a delete git accepted', 'deleted herd/x (2 attempt(s))'));
  assert.equal(r.attempts, 2);
  assert.equal(isRetry(r), true);
});

// The delete job now exits non-zero on a cleared retry as well, printing two
// explanatory lines after the verdict. They are checked here because they sit
// in the log BELOW the line this parser anchors on: if a future edit reorders
// them, or a pattern here grows loose enough to match one of them, a retry that
// cleared would be classified as something else and drop out of the tally #44
// is counting. The attempt count has to survive the run being red.
test('a cleared retry still classifies as a retry now that the job ends red', () => {
  const r = classifyLog(stamped(
    'attempt 1: herd/x is back 5s after a delete git accepted',
    'deleted herd/x (2 attempt(s))',
    'herd/x was put back 1 time(s) after a delete git accepted, and is gone now',
    'failing on purpose: the branch is clean, the writer is unexplained - see rovar-no #44',
  ));
  assert.equal(r.outcome, 'deleted');
  assert.equal(r.branch, 'herd/x');
  assert.equal(r.attempts, 2);
  assert.equal(isRetry(r), true);
  assert.equal(isFailure(r), false);
});

// And the same two lines on their own must not be read as a verdict at all,
// which is what would happen if one of the patterns were anchored loosely.
test('the red-on-purpose lines are not a verdict by themselves', () => {
  assert.equal(classifyLog(stamped('herd/x was put back 1 time(s) after a delete git accepted, and is gone now')).outcome, 'unknown');
  assert.equal(classifyLog(stamped('failing on purpose: the branch is clean, the writer is unexplained - see rovar-no #44')).outcome, 'unknown');
});

test('the loop giving up is a failure, with its count', () => {
  const r = classifyLog(stamped('herd/x SURVIVED 4 delete attempts (still on the remote per git)'));
  assert.equal(r.outcome, 'survived');
  assert.equal(r.attempts, 4);
  assert.equal(isFailure(r), true);
});

test('the pre-#45 failure shapes are still recognised', () => {
  assert.equal(classifyLog(stamped('herd/header-says-what-172-found SURVIVED the delete (still on the remote per git)')).outcome, 'survived');
  assert.equal(classifyLog(stamped('herd/delete-push-needs-a-repo came back within 15s of a delete git confirmed')).outcome, 'returned');
});

test('a return during the final settle is a failure', () => {
  const r = classifyLog(stamped('herd/x came back after the delete had settled (1 attempt(s))'));
  assert.equal(r.outcome, 'returned');
  assert.equal(isFailure(r), true);
});

test('the quiet outcomes are named rather than lumped into unknown', () => {
  assert.equal(classifyLog(stamped('herd/x is already gone')).outcome, 'already-gone');
  assert.equal(classifyLog(stamped('git ls-remote could not read the remote, so nothing here can say whether herd/x is gone')).outcome, 'unreadable');
  assert.equal(classifyLog(stamped('PR closed without merging, leaving herd/x')).outcome, 'not-merged');
  assert.equal(classifyLog(stamped('bjorn/x is not ours, leaving it')).outcome, 'not-ours');
});

// git's own push output contains "[deleted]" on its own line. Reading that as
// the job's verdict would report every run as a clean delete, which is a check
// that cannot fail - the exact thing this repo keeps having to unlearn.
test("git's push output is not mistaken for the verdict", () => {
  const r = classifyLog(stamped('To https://git-ci.pebblecove.xyz:8447/bjorn/rovar-no.git', ' - [deleted]         herd/x', 'herd/x SURVIVED 4 delete attempts (still on the remote per git)'));
  assert.equal(r.outcome, 'survived');
});

// A remote the job could not read is red and says so, and the tally must not
// count it as a clean delete: nothing was deleted and nothing was verified.
// It is not a failure of the retry either - the retry never ran.
test('an unreadable remote is neither clean nor a retry failure', () => {
  const r = classifyLog(stamped('fatal: could not read Username', 'git ls-remote could not read the remote, so nothing here can say whether herd/x is gone'));
  assert.equal(r.outcome, 'unreadable');
  assert.equal(r.branch, 'herd/x');
  assert.equal(isRetry(r), false);
  assert.equal(isFailure(r), false);
  assert.equal(summarise([r]).clean, 0);
  assert.equal(summarise([r]).unknown, 0);
});

// The already-gone path now looks twice before it says so, and when the ref is
// back on the second look the job deletes it and counts the foreign delete as
// the first attempt. That is what keeps the verdict line, the exit code and
// this parser saying one thing: the run is red AND reads as a retry that
// cleared, rather than red while the tally files it under clean.
test('a ref that was gone and came back classifies as a cleared retry', () => {
  const r = classifyLog(stamped(
    'herd/x read as gone and was back 10s later, so a delete this job did not issue was undone',
    'To https://git-ci.pebblecove.xyz:8447/bjorn/rovar-no.git',
    ' - [deleted]         herd/x',
    'deleted herd/x (2 attempt(s))',
    'herd/x was put back 1 time(s) after a delete git accepted, and is gone now',
  ));
  assert.equal(r.outcome, 'deleted');
  assert.equal(r.attempts, 2);
  assert.equal(isRetry(r), true);
});

test('a log ending on nothing recognised is unknown, not clean', () => {
  const r = classifyLog(stamped('🏁  Job succeeded'));
  assert.equal(r.outcome, 'unknown');
  assert.equal(isRetry(r), false);
  assert.equal(isFailure(r), false);
});

// #60: the first summary line prints a total, and the buckets under it have to
// account for all of it. They did not - already-gone, not-merged and not-ours
// landed in `runs` and nowhere else, so a window of runs where the job
// correctly had nothing to do read as a total with three zeroes beneath it and
// no explanation. This is the test that keeps it true as outcomes are added:
// every outcome the parser can produce goes in exactly one bucket.
test('every outcome classifyLog can return lands in exactly one bucket', () => {
  for (const outcome of OUTCOMES) {
    const r = { outcome, attempts: outcome === 'deleted' ? 1 : null, branch: 'herd/x', line: 'x' };
    const s = summarise([r]);
    const inBuckets = s.clean + s.retried.length + s.preserved.length + s.failed.length + s.unreadable.length + s.quiet + s.unknown;
    assert.equal(inBuckets, 1, `${outcome} is in ${inBuckets} buckets, not 1`);
    assert.equal(s.unaccounted, 0, `${outcome} is unaccounted for`);
  }
});

// The regression itself, as the numbers a reader actually sees.
test('a window of quiet runs says so instead of printing a total with nothing under it', () => {
  const s = summarise([
    { outcome: 'deleted', attempts: 1, branch: 'a' },
    { outcome: 'already-gone', attempts: null, branch: 'b' },
    { outcome: 'already-gone', attempts: null, branch: 'c' },
    { outcome: 'not-merged', attempts: null, branch: 'd' },
  ]);
  assert.equal(s.runs, 4);
  assert.equal(s.quiet, 3);
  assert.equal(s.unaccounted, 0);
  const lines = summaryLines(s, { hours: 24 });
  assert.match(lines.join('\n'), /3 run\(s\) had nothing to delete/);
});

// An unreadable remote is a red job, so it gets a named line rather than being
// folded in with the runs that had nothing to do. It is not counted as a
// delete failure either - the retry never got the chance to run.
test('an unreadable remote gets its own line in the summary', () => {
  const s = summarise([{ outcome: 'unreadable', attempts: null, branch: 'herd/x', line: 'x' }]);
  assert.equal(s.failed.length, 0);
  assert.equal(s.quiet, 0);
  assert.equal(s.unreadable.length, 1);
  assert.match(summaryLines(s, { hours: 24 }).join('\n'), /UNREADABLE {2}herd\/x/);
});

// The escape hatch has to be visible when it fires: an outcome added to the
// parser with no bucket must show up as a line, not as a total that no longer
// adds up.
test('a run in no bucket is reported rather than swallowed', () => {
  const s = summarise([{ outcome: 'something-new', attempts: null, branch: 'herd/x' }]);
  assert.equal(s.unaccounted, 1);
  assert.match(summaryLines(s, { hours: 24 }).join('\n'), /1 run\(s\) in no bucket at all/);
});

test('the summary counts each kind apart', () => {
  const s = summarise([
    { outcome: 'deleted', attempts: 1, branch: 'a' },
    { outcome: 'deleted', attempts: null, branch: 'b' },
    { outcome: 'deleted', attempts: 3, branch: 'c' },
    { outcome: 'survived', attempts: 4, branch: 'd', line: 'd SURVIVED 4 delete attempts ' },
    { outcome: 'preserved', attempts: null, branch: 'e', line: 'e KEPT as a specimen: x' },
    { outcome: 'unknown', attempts: null, branch: null },
  ]);
  assert.equal(s.runs, 6);
  assert.equal(s.clean, 2);
  assert.deepEqual(s.retried.map((r) => r.branch), ['c']);
  assert.deepEqual(s.failed.map((r) => r.branch), ['d']);
  assert.deepEqual(s.preserved.map((r) => r.branch), ['e']);
  assert.equal(s.unknown, 1);
  assert.equal(s.unaccounted, 0);
  const out = summaryLines(s, { hours: 26 }).join('\n');
  assert.match(out, /6 delete run\(s\) in the last 26h: 2 clean, 1 kept as a specimen, 1 needed a retry, 1 gave up/);
  assert.match(out, /RETRIED {2}c {2}cleared on attempt 3/);
});

// The comment exists to answer #44. Nothing to say means no comment at all,
// rather than a daily "still nothing" that would train everyone to ignore it.
test('a window with no retries produces no comment', () => {
  assert.equal(tallyComment(summarise([{ outcome: 'deleted', attempts: 1, branch: 'a' }]), { hours: 26 }), null);
  assert.equal(tallyComment(summarise([{ outcome: 'survived', attempts: 4, branch: 'd', line: 'x' }]), { hours: 26 }), null);
});

// A retry in a fresh window would now mean an older job shape is still running
// somewhere, because the current one never makes a second attempt. The parser
// keeps reading the line either way: four generations of this workflow are
// inside the 240h window it reads.
test('a retry produces a comment, and a failure in the same window is mentioned', () => {
  const body = tallyComment(summarise([
    { outcome: 'deleted', attempts: 2, branch: 'herd/x' },
    { outcome: 'survived', attempts: 4, branch: 'herd/y', line: 'x' },
  ]), { hours: 26 });
  assert.match(body, /needed more than one attempt/);
  assert.match(body, /`herd\/x` - cleared on attempt 2/);
  assert.match(body, /1 run\(s\) gave up/);
  assert.match(body, /an older job shape is still live/);
});

// The trap that a first pass walked straight into. The #8-era job printed the
// HTTP status of its API DELETE in parentheses, in the same position the
// attempt count now occupies. Four such runs are still in this repo's logs. A
// pattern that read any parenthesised number as the count would report
// `herd/deps-update` as a retry that cleared on attempt 204 - a fabricated
// finding on the exact issue this tally reports to.
test('an old API status is not read as an attempt count', () => {
  const r = classifyLog(stamped('deleted herd/deps-update (204)'));
  assert.equal(r.outcome, 'deleted');
  assert.equal(r.branch, 'herd/deps-update');
  assert.equal(r.attempts, null);
  assert.equal(isRetry(r), false);
});

test('the three success shapes are told apart', () => {
  assert.equal(classifyLog(stamped('deleted herd/x (3 attempt(s))')).attempts, 3);
  assert.equal(classifyLog(stamped('deleted herd/x (204)')).attempts, null);
  assert.equal(classifyLog(stamped('deleted herd/x')).attempts, null);
});

// #65. The current job's restore verdict. A kept specimen is not a failure and
// not a retry: nothing went wrong that the job could have done better, and the
// branch is deliberately still on the remote so its reflog survives to be read.
test('a kept specimen is recognised and is its own outcome', () => {
  const r = classifyLog('2026-09-21T10:00:00Z herd/x KEPT as a specimen: the forge put it back within 5s of a delete git accepted');
  assert.equal(r.outcome, 'preserved');
  assert.equal(r.branch, 'herd/x');
  assert.equal(r.attempts, null, 'there is no attempt count to record when the job never retries');
  assert.ok(isPreserved(r));
  assert.ok(!isFailure(r), 'a kept specimen is not the job giving up');
  assert.ok(!isRetry(r), 'a kept specimen is not a retry - that is the shape this replaced');
});

// The line git itself prints on a delete push contains "[deleted]", and a
// preserved run's log still carries the push output above its verdict. The
// parser must not read that as the job's own verdict.
test('a kept specimen is not read as a clean delete', () => {
  const log = [
    '2026-09-21T10:00:00Z To https://forge/bjorn/rovar-no.git',
    '2026-09-21T10:00:00Z  - [deleted]         herd/x',
    '2026-09-21T10:00:05Z herd/x KEPT as a specimen: the forge put it back within 5s of a delete git accepted',
  ].join('\n');
  const s = summarise([classifyLog(log)]);
  assert.equal(s.clean, 0, 'a kept specimen must never be counted clean');
  assert.equal(s.preserved.length, 1);
  assert.equal(s.unaccounted, 0);
});

test('the summary names a kept specimen on its own line', () => {
  const s = summarise([classifyLog('herd/x KEPT as a specimen: the forge put it back after the delete had settled')]);
  const out = summaryLines(s, { hours: 24 }).join('\n');
  assert.match(out, /1 kept as a specimen/);
  assert.match(out, /SPECIMEN herd\/x/);
});

// The tally posts the record; the job posts the notice. The distinction is not
// stylistic: merge-audit.yml runs this at 05:13 and the sweep runs at 04:53, so
// anything written here about a live specimen is twenty minutes late by
// construction and must not be phrased as a call to action.
test('the tally reports a kept specimen without pretending it is still actionable', () => {
  const s = summarise([classifyLog('herd/x KEPT as a specimen: the forge put it back within 5s of a delete git accepted')]);
  const body = tallyComment(s, { hours: 24 });
  assert.ok(body, 'a window with a kept specimen is news');
  assert.match(body, /herd\/x/);
  assert.match(body, /posted its own comment/, 'it should point at the notice rather than be the notice');
});

test('a window of nothing but clean runs still says nothing', () => {
  const s = summarise([classifyLog('deleted herd/x (1 attempt(s))')]);
  assert.equal(tallyComment(s, { hours: 24 }), null);
});
