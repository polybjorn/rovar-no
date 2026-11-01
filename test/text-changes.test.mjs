// node --test. Holds docs/text-changes.yaml to the shape the client page
// renders, so a broken list fails here instead of leaving the board an old copy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

import { checkShape } from '../scripts/text-changes-core.mjs';

test('the list in the repo has the shape the client page renders', () => {
  checkShape(parse(readFileSync('docs/text-changes.yaml', 'utf8')));
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
