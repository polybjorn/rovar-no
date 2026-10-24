// node --test. Covers scripts/text-changes-core.mjs, and holds
// docs/text-changes.yaml to the shape the client page renders, so a broken
// list fails here instead of leaving the board an old copy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

import { verdict, range, checkShape, LIST } from '../scripts/text-changes-core.mjs';

test('the list in the repo has the shape the client page renders', () => {
  checkShape(parse(readFileSync(LIST, 'utf8')));
});

test('page text needs the list or a line saying no words changed', () => {
  const page = 'src/content/pages/no/opplev.md';
  assert.equal(verdict({ files: ['package-lock.json'], messages: [] }).ok, true);
  assert.equal(verdict({ files: [page, LIST], messages: [] }).ok, true);
  assert.equal(verdict({ files: ['src/i18n/ui/en.json'], messages: ['fix: x'] }).ok, false);
  assert.deepEqual(verdict({ files: [page, 'src/styles/global.css'], messages: ['fix: x'] }).files, [page]);
  assert.equal(verdict({ files: [page], messages: ['fix: x\n\nText-changes: none\n'] }).ok, true);
  // Mentioned in prose, the marker opts nothing out.
  assert.equal(verdict({ files: [page], messages: ['fix: x\n\nno Text-changes: none here'] }).ok, false);
});

test('components and the i18n code are not page text', () => {
  const files = ['src/components/Footer.astro', 'src/i18n/pages.js', 'src/i18n/ui/index.js'];
  assert.equal(verdict({ files, messages: [] }).ok, true);
});

test('the range is the push, the pull request, or nothing', () => {
  const base = { sha: 'b', mergeBase: (a, b) => `mb(${a},${b})`, exists: () => true };
  assert.deepEqual(range({ ...base, event: 'push', before: 'a' }), { from: 'a', to: 'b' });
  assert.deepEqual(range({ ...base, event: 'push', before: '0'.repeat(40) }), { from: 'b^1', to: 'b' });
  assert.deepEqual(range({ ...base, event: 'pull_request', baseRef: 'main' }), { from: 'mb(origin/main,b)', to: 'b' });
  assert.equal(range({ ...base, event: 'workflow_dispatch' }), null);
  assert.equal(range({ ...base, event: 'push', before: 'a', exists: (r) => r === 'b' }), null);
  assert.throws(() => range({ ...base, event: 'push', before: 'a', exists: () => false }), /not in the checkout/);
});

test('the shape check refuses what the renderer refuses', () => {
  assert.throws(() => checkShape({ groups: [{ title: 'A', body: 'x' }] }), /groups\[0\]: unknown key 'body'/);
  assert.throws(() => checkShape({ note: 'x' }), /groups: missing/);
  assert.throws(() => checkShape({ groups: [{ points: [] }] }), /groups\[0\].title: missing/);
  assert.throws(
    () => checkShape({ groups: [{ title: 'A', table: { head: ['a', 'b'], rows: [['x']] } }] }),
    /as many cells/
  );
  checkShape({ groups: [{ title: 'A', points: [{ title: 'B', table: { rows: [['x', 'y']] } }] }] });
});
