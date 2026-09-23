// The sweep's specimen holdback, run against a real repository over file://
// rather than asserted against the text of the workflow.
//
// WHY THIS EXISTS. #65 measured that deleting a ref destroys its reflog - on
// git 2.54.0 locally, and in production on the 2026-09-15 specimen whose reflog
// held exactly one entry because its own earlier push and delete had gone with
// the ref. That reflog is the only evidence separating #44's two faults, so the
// delete job now keeps a restored branch instead of deleting it again. This is
// the other half: a sweep that took the branch the next morning would destroy
// the same evidence a few hours later instead of a few seconds later.
//
// The sweep is the last line of defence and it has already had one silent bug
// (#47's glob, which made branches invisible while the job stayed green), so a
// change to it gets run rather than read. Both steps are lifted out of the YAML
// and executed: a real bare repo as the remote, real branches, real markers,
// real deletes. The only thing stubbed is the one case a real remote cannot be
// made to produce on demand, and that stub delegates to git for everything else.
//
// #65.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORKFLOW = '.forgejo/workflows/delete-merged-branch.yml';

// Every `run: |` block in the workflow, lifted by indentation. No YAML parser:
// the repo has no yaml dependency of its own and a transitive one is not
// something a test should reach into. Both blocks are the sweep's: the delete
// job above it is bjorn/ci-actions/delete-merged-branch@v1 and carries no
// script here to lift.
const runBlocks = () => {
  const lines = readFileSync(WORKFLOW, 'utf8').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== '        run: |') continue;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') { body.push(''); continue; }
      if (!l.startsWith('          ')) break;
      body.push(l.slice(10));
    }
    out.push(body.join('\n'));
  }
  return out;
};

const sweepSteps = () => {
  const blocks = runBlocks();
  assert.equal(blocks.length, 2, `expected 2 run blocks in ${WORKFLOW}, found ${blocks.length} - has a step been added or re-indented?`);
  const [find, del] = blocks;
  assert.match(find, /refs\/specimens/, 'the find step does not look like the one that reads specimen markers');
  assert.match(del, /swept \$deleted/, 'the delete step is missing its summary line');
  return { find, del };
};

const day = (offset) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

// A real bare repository, with real branches and real specimen markers on it.
// `uploadpack.allowFilter` because the sweep clones with --filter=blob:none and
// a local server refuses a partial clone without it; that is a property of this
// scratch remote, not of the sweep.
const makeOrigin = ({ branches = [], markers = [] } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'sweep-spec-'));
  const origin = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  execFileSync('git', ['-C', origin, 'config', 'uploadpack.allowFilter', 'true']);

  const work = join(root, 'work');
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  const git = (...a) => execFileSync('git', ['-C', work, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
  git('commit', '-q', '--allow-empty', '-m', 'root');
  git('remote', 'add', 'origin', origin);
  git('push', '-q', 'origin', 'main');
  for (const b of branches) {
    git('branch', b, 'main');
    git('push', '-q', 'origin', b);
  }
  const sha = git('rev-parse', 'HEAD').trim();
  for (const m of markers) git('push', '-q', 'origin', `${sha}:refs/specimens/${m}`);
  return { root, origin, work, git, sha };
};

const remoteRefs = (origin) =>
  execFileSync('git', ['ls-remote', origin], { encoding: 'utf8' })
    .split('\n').filter(Boolean).map((l) => l.split('\t')[1]).sort();

// Runs both sweep steps the way the runner would, in order, sharing a work
// directory exactly as two steps of one job share /tmp.
const runSweep = ({ root, origin, gitWrapper = null }) => {
  const W = mkdtempSync(join(tmpdir(), 'sweep-work-'));
  const env = {
    ...process.env,
    SWEEP_WORK: W,
    SERVER: `file://${root}`,
    REPO: 'origin',
    TOKEN: 'x',
  };
  if (gitWrapper) {
    const bin = join(W, 'bin');
    mkdirSync(bin);
    const p = join(bin, 'git');
    writeFileSync(p, gitWrapper);
    chmodSync(p, 0o755);
    env.PATH = `${bin}:${process.env.PATH}`;
    env.REAL_GIT = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  }
  const { find, del } = sweepSteps();
  const out = [];
  for (const [name, src] of [['find', find], ['delete', del]]) {
    const f = join(W, `${name}.sh`);
    writeFileSync(f, src);
    const r = spawnSync('bash', [f], { encoding: 'utf8', env, cwd: root });
    out.push({ name, code: r.status, log: `${r.stdout}${r.stderr}` });
    if (r.status !== 0) break;
  }
  rmSync(W, { recursive: true, force: true });
  void origin;
  return out;
};

test('a branch with no marker is swept, which is the control', () => {
  const o = makeOrigin({ branches: ['herd/a', 'herd/b'] });
  try {
    const steps = runSweep(o);
    assert.equal(steps.at(-1).code, 0, steps.map((s) => s.log).join('\n'));
    assert.deepEqual(remoteRefs(o.origin).filter((r) => r.startsWith('refs/heads/')), ['refs/heads/main'],
      'without markers both merged branches should be gone - if they are not, every assertion below passes for the wrong reason');
  } finally {
    rmSync(o.root, { recursive: true, force: true });
  }
});

test('a marked branch is kept and its marker is kept with it', () => {
  const o = makeOrigin({ branches: ['herd/a', 'herd/b'], markers: [`${day(0)}/herd/a`] });
  try {
    const steps = runSweep(o);
    assert.equal(steps.at(-1).code, 0, steps.map((s) => s.log).join('\n'));
    const refs = remoteRefs(o.origin);
    assert.ok(refs.includes('refs/heads/herd/a'), 'the specimen was swept - its reflog is the evidence #44 is open for');
    assert.ok(!refs.includes('refs/heads/herd/b'), 'an unmarked branch should still be swept');
    assert.ok(refs.includes(`refs/specimens/${day(0)}/herd/a`), 'the marker must outlive the sweep that honoured it');
    assert.match(steps[0].log, /1 kept as specimen\(s\), 0 marker\(s\) expired/);
  } finally {
    rmSync(o.root, { recursive: true, force: true });
  }
});

// The bound. A specimen nobody reads must not become the branch that lives
// forever - that is the exact failure this sweep exists to catch, and it is the
// reason the hold is dated in the ref name rather than open-ended.
test('an expired marker stops protecting the branch, and goes with it', () => {
  const o = makeOrigin({ branches: ['herd/old'], markers: [`${day(-8)}/herd/old`] });
  try {
    const steps = runSweep(o);
    assert.equal(steps.at(-1).code, 0, steps.map((s) => s.log).join('\n'));
    const refs = remoteRefs(o.origin);
    assert.ok(!refs.includes('refs/heads/herd/old'), 'an expired specimen should be swept like any other merged branch');
    assert.ok(!refs.some((r) => r.startsWith('refs/specimens/')), 'the expired marker should not outlive the branch it named');
    assert.match(steps[0].log, /specimen herd\/old expired/);
  } finally {
    rmSync(o.root, { recursive: true, force: true });
  }
});

test('the boundary is held on the day itself, not a day either side', () => {
  const o = makeOrigin({ branches: ['herd/edge'], markers: [`${day(-7)}/herd/edge`] });
  try {
    runSweep(o);
    assert.ok(remoteRefs(o.origin).includes('refs/heads/herd/edge'),
      'a marker exactly at the cutoff is still inside the window');
  } finally {
    rmSync(o.root, { recursive: true, force: true });
  }
});

// A marker this job did not write, or one with a mangled name, must not be
// honoured: keeping it would be the unbounded case above, reached by a typo.
test('a marker with no readable date is expired rather than honoured forever', () => {
  const o = makeOrigin({ branches: ['herd/weird'], markers: ['not-a-date/herd/weird'] });
  try {
    const steps = runSweep(o);
    assert.match(steps[0].log, /has no readable date, expiring it/);
    const refs = remoteRefs(o.origin);
    assert.ok(!refs.includes('refs/heads/herd/weird'), 'a branch behind an unreadable marker is not protected');
    assert.ok(!refs.some((r) => r.startsWith('refs/specimens/')), 'and the bad marker is cleared');
  } finally {
    rmSync(o.root, { recursive: true, force: true });
  }
});

// #59's lesson, in the one place where getting it wrong sweeps the specimen
// this whole arrangement exists to keep: an empty marker list and a marker list
// that could not be read look identical, and only one of them means "nothing to
// keep". The wrapper is real git for everything except that one read.
test('a marker list that cannot be read stops the sweep instead of emptying it', () => {
  const o = makeOrigin({ branches: ['herd/a'], markers: [`${day(0)}/herd/a`] });
  try {
    const steps = runSweep({
      ...o,
      gitWrapper: `#!/usr/bin/env bash
for a in "$@"; do
  if [ "$a" = 'refs/specimens/*' ]; then
    echo "fatal: could not read from remote repository" >&2
    exit 128
  fi
done
exec "\${REAL_GIT}" "$@"
`,
    });
    assert.equal(steps[0].code, 1, 'an unreadable marker list must fail the step');
    assert.match(steps[0].log, /could not read the specimen markers/);
    assert.equal(steps.length, 1, 'and nothing should be deleted after it');
    assert.ok(remoteRefs(o.origin).includes('refs/heads/herd/a'), 'the specimen must survive a read that failed');
  } finally {
    rmSync(o.root, { recursive: true, force: true });
  }
});

test('a branch that is not merged is still left alone, marker or none', () => {
  const o = makeOrigin({ branches: [] });
  try {
    o.git('checkout', '-q', '-b', 'herd/live', 'main');
    o.git('commit', '-q', '--allow-empty', '-m', 'unmerged');
    o.git('push', '-q', 'origin', 'herd/live');
    const steps = runSweep(o);
    assert.equal(steps.at(-1).code, 0, steps.map((s) => s.log).join('\n'));
    assert.ok(remoteRefs(o.origin).includes('refs/heads/herd/live'));
    assert.match(steps[0].log, /keep {3}herd\/live \(not an ancestor of main\)/);
  } finally {
    rmSync(o.root, { recursive: true, force: true });
  }
});
