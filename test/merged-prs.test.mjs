import test from 'node:test';
import assert from 'node:assert/strict';
import { collectClosed, mergedWithin, classify, summaryLines, remoteRefParts } from '../scripts/merged-prs-core.mjs';

const pr = (number, over = {}) => ({
  number,
  title: `pr ${number}`,
  merged: true,
  merge_commit_sha: `${String(number).padStart(2, '0')}abcdef0123456789`,
  merged_at: '2026-09-14T12:00:00Z',
  updated_at: '2026-09-14T12:00:00Z',
  ...over,
});

const pageOf = (pages) => async (n) => pages[n - 1] ?? [];

test('paging stops on a short page', async () => {
  const r = await collectClosed(pageOf([[pr(1), pr(2)]]), { limit: 50 });
  assert.equal(r.complete, true);
  assert.equal(r.pages, 1);
  assert.equal(r.pulls.length, 2);
});

test('paging continues while pages come back full', async () => {
  const full = (n) => Array.from({ length: 2 }, (_, i) => pr(n * 10 + i));
  const r = await collectClosed(pageOf([full(1), full(2), [pr(99)]]), { limit: 2 });
  assert.equal(r.complete, true);
  assert.equal(r.pages, 3);
  assert.equal(r.pulls.length, 5);
});

// Merging updates a pull request, so merged_at <= updated_at: once a full
// page's oldest updated_at predates the window, no later page can hold
// anything inside it.
test('paging stops once a full page predates the window', async () => {
  const since = Date.parse('2026-09-10T00:00:00Z');
  const recent = [pr(1), pr(2, { updated_at: '2026-09-11T00:00:00Z' })];
  const old = [pr(3, { updated_at: '2026-09-01T00:00:00Z' }), pr(4, { updated_at: '2026-08-30T00:00:00Z' })];
  const r = await collectClosed(pageOf([recent, old, [pr(5)]]), { limit: 2, since });
  assert.equal(r.pages, 2);
  assert.equal(r.complete, true);
});

// The one way this check can report "all reachable" about pull requests it
// never looked at.
test('running out of pages is reported as incomplete, not as a clean result', async () => {
  const full = () => [pr(1), pr(2)];
  const r = await collectClosed(pageOf([full(), full(), full(), full()]), { limit: 2, maxPages: 3, since: 0 });
  assert.equal(r.complete, false);
  assert.equal(r.pages, 3);
});

test('only merged pulls inside the window, and only with a merge commit', () => {
  const now = Date.parse('2026-09-14T12:00:00Z');
  const pulls = [
    pr(1),
    pr(2, { merged: false }),
    pr(3, { merge_commit_sha: null }),
    pr(4, { merged_at: '2026-08-01T00:00:00Z' }),
  ];
  assert.deepEqual(mergedWithin(pulls, 7, now).map((p) => p.number), [1]);
});

test('classify separates unreachable from missing', () => {
  const pulls = [pr(1), pr(2), pr(3)];
  const states = { [pulls[0].merge_commit_sha]: 'reachable', [pulls[1].merge_commit_sha]: 'unreachable', [pulls[2].merge_commit_sha]: 'missing' };
  const r = classify(pulls, (sha) => states[sha]);
  assert.equal(r.checked, 3);
  assert.deepEqual(r.orphans.map((p) => p.number), [2]);
  assert.deepEqual(r.missing.map((p) => p.number), [3]);
  assert.equal(r.ok, false);
});

test('all reachable is ok', () => {
  const r = classify([pr(1), pr(2)], () => 'reachable');
  assert.equal(r.ok, true);
  assert.deepEqual(r.orphans, []);
});

test('a clean report says so and nothing else', () => {
  const r = classify([pr(1)], () => 'reachable');
  const lines = summaryLines(r, { ref: 'origin/main', days: 7 });
  assert.match(lines[0], /checked 1 merged pull request from the last 7 days against origin\/main/);
  assert.equal(lines.at(-1), '  all reachable');
  assert.equal(lines.some((l) => /ORPHANED|UNFETCHABLE/.test(l)), false);
});

test('a failing report names the number, the sha and which fault it is', () => {
  const pulls = [pr(7), pr(8)];
  const states = { [pulls[0].merge_commit_sha]: 'unreachable', [pulls[1].merge_commit_sha]: 'missing' };
  const r = classify(pulls, (sha) => states[sha]);
  const out = summaryLines(r, { ref: 'origin/main', days: 7, parentsOf: () => 'aaaa bbbb' }).join('\n');
  assert.match(out, /ORPHANED {5}#7 {2}07abcde {2}pr 7/);
  assert.match(out, /parents aaaa bbbb, not reachable from origin\/main/);
  assert.match(out, /UNFETCHABLE {2}#8 {2}08abcde {2}pr 8/);
  assert.match(out, /will not serve the object/);
  assert.match(out, /cherry-pick -x/);
  // The two faults are different and the report must not flatten them.
  assert.equal(/ORPHANED {5}#8/.test(out), false);
});

test('plural agreement, because this line is read every day', () => {
  const one = summaryLines(classify([pr(1)], () => 'reachable'), { ref: 'main', days: 1 })[0];
  const two = summaryLines(classify([pr(1), pr(2)], () => 'reachable'), { ref: 'main', days: 1 })[0];
  assert.match(one, /1 merged pull request from/);
  assert.match(two, /2 merged pull requests from/);
});

// A stale remote-tracking ref invents orphans exactly like a shallow clone,
// and more convincingly: two plausible orphans rather than a broken page of
// them. This decides what the runner has to refresh before judging.
test('a remote-tracking ref is recognised so it can be refreshed', () => {
  assert.deepEqual(remoteRefParts('origin/main', ['origin']), { remote: 'origin', branch: 'main' });
  assert.deepEqual(remoteRefParts('upstream/release/7.x', ['origin', 'upstream']), {
    remote: 'upstream',
    branch: 'release/7.x',
  });
});

test('anything not a remote-tracking ref is left alone', () => {
  assert.equal(remoteRefParts('main', ['origin']), null);
  assert.equal(remoteRefParts('2641a757564c5b67a9cfcb6b946bd1164cc5aefb', ['origin']), null);
  // A branch whose name merely starts like a remote is not one.
  assert.equal(remoteRefParts('feature/thing', ['origin']), null);
  assert.equal(remoteRefParts('origin/', ['origin']), null);
  assert.equal(remoteRefParts('/main', ['origin']), null);
});
