// The sweep's candidate enumeration, tested against a real repository rather
// than against a string.
//
// #47: `refs/heads/herd/*` does not match across a slash, so `herd/deps/bump`
// was never a candidate and nothing would ever have swept it. The failure was
// silent - the branch was absent from the list, the run reported `swept N` over
// the ones it did see, and the job went green.
//
// Asserting that the file contains `**` would pass on a typo and would not
// notice if git's semantics ever changed. So this reads the pattern out of the
// workflow and runs THAT against a repository with nested branches. It fails if
// the pattern regresses, and it would also fail if the assumption behind the
// fix turned out to be wrong.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORKFLOW = '.forgejo/workflows/delete-merged-branch.yml';

// The pattern the sweep actually passes to for-each-ref, not a copy of it.
const sweepPattern = () => {
  const src = readFileSync(WORKFLOW, 'utf8');
  const m = src.match(/for-each-ref --format='%\(refname:short\)' '([^']+)'/);
  assert.ok(m, `no for-each-ref invocation found in ${WORKFLOW} - has the sweep moved?`);
  return m[1];
};

const BRANCHES = ['herd/flat', 'herd/deps/bump', 'herd/a/b/c', 'other/x'];

const scratchRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-glob-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  execFileSync('git', ['init', '-q', dir]);
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
  for (const b of BRANCHES) git('branch', b);
  return { dir, git };
};

test('the sweep pattern sees nested herd/ branches', () => {
  const { dir, git } = scratchRepo();
  try {
    const found = git('for-each-ref', '--format=%(refname:short)', sweepPattern())
      .split('\n').filter(Boolean).sort();
    assert.deepEqual(found, ['herd/a/b/c', 'herd/deps/bump', 'herd/flat'],
      'a branch missing here is a branch nothing would ever sweep');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a single star really does miss them, which is what #47 was', () => {
  // The control. Without this, the test above would still pass if git stopped
  // distinguishing the two patterns, and it would be testing nothing.
  const { dir, git } = scratchRepo();
  try {
    const single = git('for-each-ref', '--format=%(refname:short)', 'refs/heads/herd/*')
      .split('\n').filter(Boolean);
    assert.deepEqual(single, ['herd/flat']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the sweep pattern is still scoped to herd/', () => {
  // The prefix decides whose branches to consider. Widening the glob must not
  // have widened that.
  const { dir, git } = scratchRepo();
  try {
    const found = git('for-each-ref', '--format=%(refname:short)', sweepPattern()).split('\n').filter(Boolean);
    assert.ok(!found.includes('other/x'), 'the sweep must not consider branches outside herd/');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
