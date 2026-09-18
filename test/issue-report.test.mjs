// node --test. Covers scripts/issue-report-core.mjs, the decision a reporting
// step makes before it posts. The bug this file exists for was not in the
// posting and not in the prover: it was in the read in front of the post, which
// failed hard and took a daily audit down with it (#54).
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportPlan } from '../scripts/issue-report-core.mjs';

const MARK = '<!-- inert-check -->';

test('posts when there is a token and the marker is not there yet', () => {
  const plan = reportPlan({ token: 't', existing: [{ body: 'a human said something' }], mark: MARK });
  assert.equal(plan.post, true);
});

test('an empty comment list is a successful read, not a failed one', () => {
  assert.equal(reportPlan({ token: 't', existing: [], mark: MARK }).post, true);
});

test('does not post twice on the same pull request', () => {
  const plan = reportPlan({ token: 't', existing: [{ body: `${MARK}\nProvably inert.` }], mark: MARK });
  assert.equal(plan.post, false);
  assert.equal(plan.why, 'already reported');
});

// THE SAFETY RULE. A 403 on the read must suppress the post, never force it:
// commenting without knowing what is already there is how a daily schedule
// repeats itself into a filter.
test('a failed read suppresses the post rather than risking a repeat', () => {
  const plan = reportPlan({ token: 't', existing: null, mark: MARK });
  assert.equal(plan.post, false);
  assert.match(plan.why, /could not read/);
});

test('null is not confused with an empty list', () => {
  assert.notEqual(
    reportPlan({ token: 't', existing: null, mark: MARK }).post,
    reportPlan({ token: 't', existing: [], mark: MARK }).post,
  );
});

test('no token means no post, and says so rather than throwing', () => {
  const plan = reportPlan({ token: '', existing: [], mark: MARK });
  assert.equal(plan.post, false);
  assert.match(plan.why, /no issue token/);
});

// A comment whose body the forge omitted must not read as "not the marker" and
// must not throw either - the scan has to survive a row it cannot parse.
test('a comment with no body is survived rather than thrown on', () => {
  assert.equal(reportPlan({ token: 't', existing: [{}, { body: null }], mark: MARK }).post, true);
  assert.equal(reportPlan({ token: 't', existing: [null], mark: MARK }).post, true);
});

test('every refusal carries a reason worth printing', () => {
  for (const args of [
    { token: '', existing: [], mark: MARK },
    { token: 't', existing: null, mark: MARK },
    { token: 't', existing: [], mark: '' },
    { token: 't', existing: [{ body: MARK }], mark: MARK },
  ]) {
    const plan = reportPlan(args);
    assert.equal(plan.post, false);
    assert.ok(plan.why && plan.why.length > 3, `no reason given for ${JSON.stringify(args)}`);
  }
});
