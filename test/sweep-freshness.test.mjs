import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTasks, sweepTasks, verdict, summaryLines } from '../scripts/sweep-freshness-core.mjs';

const NOW = Date.parse('2026-09-15T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString();

const task = (over = {}) => ({
  id: 1,
  name: 'sweep',
  workflow_id: 'delete-merged-branch.yml',
  status: 'success',
  created_at: hoursAgo(1),
  run_started_at: hoursAgo(1),
  ...over,
});

const pageOf = (pages) => async (n) => pages[n - 1] ?? [];

test('paging stops on a short page', async () => {
  const r = await collectTasks(pageOf([[task(), task()]]), { limit: 50 });
  assert.equal(r.complete, true);
  assert.equal(r.pages, 1);
  assert.equal(r.tasks.length, 2);
});

test('paging continues while pages come back full', async () => {
  const r = await collectTasks(pageOf([[task(), task()], [task(), task()], [task()]]), { limit: 2 });
  assert.equal(r.complete, true);
  assert.equal(r.pages, 3);
  assert.equal(r.tasks.length, 5);
});

test('paging stops once a full page predates the window', async () => {
  const since = NOW - 48 * 3600_000;
  const recent = [task({ run_started_at: hoursAgo(1) }), task({ run_started_at: hoursAgo(2) })];
  const old = [task({ run_started_at: hoursAgo(100) }), task({ run_started_at: hoursAgo(200) })];
  const r = await collectTasks(pageOf([recent, old, [task()]]), { limit: 2, since });
  assert.equal(r.pages, 2);
  assert.equal(r.complete, true);
});

// Running out of pages is a different fact from finding no sweep, and the
// runner must not conflate them: one is a broken backstop, the other is a
// busy runner. See check-sweep-freshness.mjs, which dies rather than reports.
test('paging reports incompleteness instead of pretending', async () => {
  const full = () => [task({ run_started_at: hoursAgo(1) }), task({ run_started_at: hoursAgo(1) })];
  const r = await collectTasks(pageOf([full(), full(), full()]), { limit: 2, maxPages: 2 });
  assert.equal(r.complete, false);
  assert.equal(r.pages, 2);
});

test('only the sweep job of the right workflow counts', () => {
  const tasks = [
    task({ id: 1, name: 'delete' }),
    task({ id: 2, name: 'sweep', workflow_id: 'ci.yml' }),
    task({ id: 3, name: 'audit', workflow_id: 'merge-audit.yml' }),
    task({ id: 4 }),
  ];
  assert.deepEqual(sweepTasks(tasks).map((t) => t.id), [4]);
});

test('a recent success passes', () => {
  const v = verdict([task({ run_started_at: hoursAgo(6) })], { now: NOW });
  assert.equal(v.ok, true);
  assert.equal(Math.round(v.ageHours), 6);
  assert.match(summaryLines(v)[0], /last succeeded 6\.0h ago, inside the 48h window/);
});

// The failure this whole check exists for: the timer stopped and nothing said
// so. It has to fail, or the sweep's own blind spot is simply inherited.
test('a stale success fails', () => {
  const v = verdict([task({ run_started_at: hoursAgo(72) })], { now: NOW });
  assert.equal(v.ok, false);
  assert.match(summaryLines(v)[0], /outside the 48h window/);
});

test('the boundary is inclusive', () => {
  assert.equal(verdict([task({ run_started_at: hoursAgo(48) })], { now: NOW }).ok, true);
  assert.equal(verdict([task({ run_started_at: hoursAgo(48.1) })], { now: NOW }).ok, false);
});

// A skipped `sweep` task is filed on every merge, because the job carries an
// `if:` that keeps it off pull_request events. Counting those as liveness would
// make this pass forever on merge traffic alone - a check that cannot fail.
test('skipped tasks are not runs', () => {
  const v = verdict([task({ status: 'skipped', run_started_at: hoursAgo(1) })], { now: NOW });
  assert.equal(v.ok, false);
  assert.equal(v.everRan, true);
  assert.match(summaryLines(v)[0], /has run but never succeeded/);
});

test('a failing sweep is not liveness either', () => {
  const v = verdict([task({ status: 'failure', run_started_at: hoursAgo(1) })], { now: NOW });
  assert.equal(v.ok, false);
  assert.equal(v.failedInWindow.length, 1);
});

test('no sweep at all is reported as such', () => {
  const v = verdict([task({ name: 'delete' })], { now: NOW });
  assert.equal(v.ok, false);
  assert.equal(v.everRan, false);
  assert.equal(v.last, null);
  assert.equal(summaryLines(v)[0], 'no branch sweep has ever run');
});

// Alive but dirty: the sweep is firing and failing, which leaves merged
// branches on the remote exactly as a dead timer does. Passing on the fresh
// success alone would hide it, so the failures are still reported.
test('a fresh success still surfaces recent failures', () => {
  const v = verdict(
    [task({ id: 7, status: 'failure', run_started_at: hoursAgo(30) }), task({ id: 8, run_started_at: hoursAgo(6) })],
    { now: NOW }
  );
  assert.equal(v.ok, true);
  assert.equal(v.failedInWindow.length, 1);
  const out = summaryLines(v).join('\n');
  assert.match(out, /FAILED {2}task 7/);
  assert.match(out, /alive but not clean/);
});

test('the newest success wins regardless of listing order', () => {
  const v = verdict(
    [task({ id: 1, run_started_at: hoursAgo(90) }), task({ id: 2, run_started_at: hoursAgo(3) })],
    { now: NOW }
  );
  assert.equal(v.ok, true);
  assert.equal(v.last.id, 2);
});

// run_started_at is when the work happened; created_at is when it was queued,
// and with one runner across seven repos a task can wait. Prefer the later one.
test('run_started_at beats created_at, and created_at is the fallback', () => {
  const queued = task({ created_at: hoursAgo(60), run_started_at: hoursAgo(5) });
  assert.equal(verdict([queued], { now: NOW }).ok, true);
  const noStart = task({ created_at: hoursAgo(5), run_started_at: undefined });
  assert.equal(verdict([noStart], { now: NOW }).ok, true);
});
