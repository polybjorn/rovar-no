import test from 'node:test';
import assert from 'node:assert/strict';
import { stripStamp, classifyLog, isRetry, isFailure, summarise, summaryLines, tallyComment } from '../scripts/delete-retries-core.mjs';

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

test('a log ending on nothing recognised is unknown, not clean', () => {
  const r = classifyLog(stamped('🏁  Job succeeded'));
  assert.equal(r.outcome, 'unknown');
  assert.equal(isRetry(r), false);
  assert.equal(isFailure(r), false);
});

test('the summary counts each kind apart', () => {
  const s = summarise([
    { outcome: 'deleted', attempts: 1, branch: 'a' },
    { outcome: 'deleted', attempts: null, branch: 'b' },
    { outcome: 'deleted', attempts: 3, branch: 'c' },
    { outcome: 'survived', attempts: 4, branch: 'd', line: 'd SURVIVED 4 delete attempts ' },
    { outcome: 'unknown', attempts: null, branch: null },
  ]);
  assert.equal(s.runs, 5);
  assert.equal(s.clean, 2);
  assert.deepEqual(s.retried.map((r) => r.branch), ['c']);
  assert.deepEqual(s.failed.map((r) => r.branch), ['d']);
  assert.equal(s.unknown, 1);
  const out = summaryLines(s, { hours: 26 }).join('\n');
  assert.match(out, /5 delete run\(s\) in the last 26h: 2 clean, 1 needed a retry, 1 gave up/);
  assert.match(out, /RETRIED {2}c {2}cleared on attempt 3/);
});

// The comment exists to answer #44. Nothing to say means no comment at all,
// rather than a daily "still nothing" that would train everyone to ignore it.
test('a window with no retries produces no comment', () => {
  assert.equal(tallyComment(summarise([{ outcome: 'deleted', attempts: 1, branch: 'a' }]), { hours: 26 }), null);
  assert.equal(tallyComment(summarise([{ outcome: 'survived', attempts: 4, branch: 'd', line: 'x' }]), { hours: 26 }), null);
});

test('a retry produces a comment, and a failure in the same window is mentioned', () => {
  const body = tallyComment(summarise([
    { outcome: 'deleted', attempts: 2, branch: 'herd/x' },
    { outcome: 'survived', attempts: 4, branch: 'herd/y', line: 'x' },
  ]), { hours: 26 });
  assert.match(body, /The retry fired and worked/);
  assert.match(body, /`herd\/x` - cleared on attempt 2/);
  assert.match(body, /1 run\(s\) gave up/);
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
