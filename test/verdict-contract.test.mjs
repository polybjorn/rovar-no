// The half of the verdict contract that needs no forge.
//
// scripts/check-verdict-contract.mjs asserts the action still PRINTS these
// lines; this asserts this repo can still READ them. Both halves come off the
// same table, so a wording that is updated in one place and not the other fails
// here rather than silently shrinking a number in the daily tally.
//
// The pin parse is tested against the real workflow file rather than a fixture:
// a check that reads the ref out of a string it also wrote would keep passing
// after the job moved to another ref, which is the failure one level up that
// this whole arrangement exists to remove.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTRACT, sample, sampleFor, actionPin, missingFrom } from '../scripts/verdict-contract-core.mjs';
import { classifyLog, OUTCOMES } from '../scripts/delete-retries-core.mjs';

const WORKFLOW = '.forgejo/workflows/delete-merged-branch.yml';

test('the contract is not empty', () => {
  // A contract of zero entries passes every check that reads it, forever.
  assert.ok(CONTRACT.length > 0);
});

test('every declared wording classifies to the outcome it claims', () => {
  for (const entry of CONTRACT) {
    const line = sampleFor(entry);
    const got = classifyLog(line);
    assert.equal(got.outcome, entry.outcome, `${line} classified as ${got.outcome}, not ${entry.outcome}`);
  }
});

test('every declared outcome is one the summary has a bucket for', () => {
  for (const entry of CONTRACT) assert.ok(OUTCOMES.includes(entry.outcome), `${entry.outcome} is in no bucket`);
});

test('a verdict line is still recognised with a runner timestamp on it', () => {
  // What the job log actually holds. classifyLog strips the stamp; this is the
  // assertion that the declared wording survives the stripping, because the
  // contract is written as the bare message.
  for (const entry of CONTRACT) {
    const stamped = `2026-09-25T09:00:00.1234567Z ${sampleFor(entry)}`;
    assert.equal(classifyLog(stamped).outcome, entry.outcome);
  }
});

test('every declared wording is found in a source that contains it', () => {
  const source = CONTRACT.map((c) => `  echo "${c.shell}" >&2`).join('\n');
  assert.deepEqual(missingFrom(source), []);
});

test('a reworded line is reported, and only that one', () => {
  // The negative control. Without it this check passes on a source that says
  // nothing, which is the state it is meant to detect.
  const target = CONTRACT[0];
  const source = CONTRACT.map((c) => (c === target ? 'echo "removed the branch"' : `echo "${c.shell}"`)).join('\n');
  const missing = missingFrom(source);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].shell, target.shell);
});

test('sample refuses a variable it has no value for', () => {
  // Otherwise a new wording gets a sample with a literal `$foo` in it, which
  // classifies as unknown and reads as a broken parser rather than a gap here.
  assert.throws(() => sample('deleted $NOPE'), /no sample value for \$NOPE/);
});

test("a replacement is not read as a substitution pattern", () => {
  // `$'` and `$&` mean something to String.replace when the replacement is a
  // string. Every line in this contract is prose full of dollar signs.
  assert.equal(sample("$BRANCH is already gone"), 'herd/x is already gone');
  assert.ok(!sample('$BRANCH $BRANCH').includes('$'));
});

test('the pin is read out of the workflow the delete job actually uses', () => {
  const pin = actionPin(readFileSync(WORKFLOW, 'utf8'));
  assert.equal(pin.repo, 'ci-actions');
  assert.equal(pin.path, 'delete-merged-branch');
  assert.ok(pin.ref.length, 'the pin has no ref');
  assert.ok(pin.base.startsWith('https://'), `the pin resolves against ${pin.base}, which is not this forge over https`);
});

test('a delete job that no longer pins the action fails loudly', () => {
  // If the step ever moves back to a `run:` block in this repo, this check is
  // checking nothing and has to say so rather than skip.
  assert.throws(() => actionPin('jobs:\n  delete:\n    steps:\n      - run: git push --delete\n'), /no `uses:/);
});
