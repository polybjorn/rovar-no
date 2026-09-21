// The delete step's own control flow, run rather than read.
//
// This file has been rewritten six times and the script inside it had never
// been executed by anything except the forge. The test suite covered the parser
// that reads its logs and one glob out of the sweep; the step's branching - the
// already-gone path, the loop, the bound, the fallback, the exit codes - was
// only ever exercised by a real merge.
//
// That is the wrong way round for this particular script, because of the thing
// #44 keeps running into: A CLEAN RUN PRINTS THE SAME LINE UNDER EVERY VERSION
// OF THIS JOB. `deleted <branch> (1 attempt(s))` and a green tick is what the
// one-shot code, #45's loop and #48's red-on-restore all produce when the forge
// does not interfere. So a merge confirms almost nothing, and the paths that
// matter are the ones no merge can be made to produce: a ref that comes back, a
// remote that will not answer, four restores in a row. Both defects fixed in
// #59 were in a path no merge since has entered.
//
// Same shape as sweep-glob.test.mjs: read the real thing out of the workflow
// and run THAT. Asserting on the text of the file would pass on a script that
// could not run at all.
//
// #62.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyLog, summarise } from '../scripts/delete-retries-core.mjs';

const WORKFLOW = '.forgejo/workflows/delete-merged-branch.yml';
const BRANCH = 'herd/x';

// The delete job's script, lifted out of the YAML by its indentation rather
// than by a YAML parser - the repo has no yaml dependency of its own and a
// transitive one is not something a test should reach into. The first `run: |`
// in the file is the delete step; the sweep's two come later.
const deleteStep = () => {
  const lines = readFileSync(WORKFLOW, 'utf8').split('\n');
  const start = lines.indexOf('        run: |');
  assert.notEqual(start, -1, `no run block found in ${WORKFLOW} - has the step moved or been re-indented?`);
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') { body.push(''); continue; }
    if (!l.startsWith('          ')) break;
    body.push(l.slice(10));
  }
  const src = body.join('\n');
  // Cheap proof we lifted the right block and all of it, so a future
  // re-indentation fails here rather than silently testing three lines.
  assert.match(src, /git ls-remote/, 'the extracted block does not look like the delete step');
  assert.match(src, /deleted \$BRANCH/, 'the extracted block is missing its verdict line');
  return src;
};

// A stub git driven by a state directory. `present` is whether the ref is on
// the remote, `restores` how many pushes get undone by the forge before one
// sticks, `reappear_after` how many reads happen before an absent ref comes
// back, `lsfail` and `pushfail` make those commands refuse.
//
// `#!/usr/bin/env bash`, and bash invoked off PATH below: the hypervisor these
// agents run on has no /bin/bash, so a hardcoded shebang exits 127 there while
// passing in CI. Same trap as the repo's own check-attribution.sh.
const STUB_GIT = `#!/usr/bin/env bash
ST="\${ST:?}"
case "$1" in
  init) shift; while [ $# -gt 1 ]; do shift; done; mkdir -p "$1"; exit 0 ;;
  ls-remote)
    echo read >> "$ST/reads"
    if [ "$(cat "$ST/lsfail")" = 1 ]; then
      echo "fatal: could not read Username for 'https://forge': terminal prompts disabled" >&2
      exit 128
    fi
    n=$(cat "$ST/reappear_after")
    if [ "$n" != "-1" ] && [ "$(wc -l < "$ST/reads")" -gt "$n" ]; then
      echo 1 > "$ST/present"; echo -1 > "$ST/reappear_after"
    fi
    [ "$(cat "$ST/present")" = 1 ] && printf 'deadbeef\\trefs/heads/${BRANCH}\\n'
    exit 0 ;;
  push)
    echo push >> "$ST/pushes"
    if [ "$(cat "$ST/pushfail")" = 1 ]; then echo "remote: permission denied" >&2; exit 1; fi
    echo " - [deleted]         ${BRANCH}" >&2
    r=$(cat "$ST/restores")
    if [ "$r" -gt 0 ]; then echo $((r - 1)) > "$ST/restores"; else echo 0 > "$ST/present"; fi
    exit 0 ;;
esac
echo "stub git: unhandled $*" >&2; exit 99
`;

const STUB_SLEEP = '#!/usr/bin/env bash\nexit 0\n';
const STUB_CURL = '#!/usr/bin/env bash\nST="${ST:?}"\necho curl >> "$ST/curls"\nprintf 500\n';

const count = (dir, name) => {
  try { return readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; }
};

// Runs the real step against the stubs and returns what a job log would show.
const run = ({ present = 1, restores = 0, reappearAfter = -1, lsfail = 0, pushfail = 0 } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'delete-step-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    for (const [name, src] of [['git', STUB_GIT], ['sleep', STUB_SLEEP], ['curl', STUB_CURL]]) {
      const p = join(bin, name);
      writeFileSync(p, src);
      chmodSync(p, 0o755);
    }
    const state = { present, restores, reappear_after: reappearAfter, lsfail, pushfail };
    for (const [k, v] of Object.entries(state)) writeFileSync(join(dir, k), `${v}\n`);
    writeFileSync(join(dir, 'reads'), '');
    writeFileSync(join(dir, 'pushes'), '');

    const script = join(dir, 'step.sh');
    writeFileSync(script, deleteStep());

    // -e, because that is how the runner invokes a `run:` block. A step that
    // only behaves under a laxer shell would pass here and fail in the forge.
    const r = spawnSync('bash', ['-e', script], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ST: dir,
        PATH: `${bin}:${process.env.PATH}`,
        TOKEN: 'tok',
        SERVER: 'https://forge',
        REPO: 'bjorn/rovar-no',
        API: 'https://forge/api/v1/repos/bjorn/rovar-no',
        BRANCH,
      },
    });
    return {
      code: r.status,
      log: `${r.stdout}${r.stderr}`,
      pushes: count(dir, 'pushes'),
      reads: count(dir, 'reads'),
      curls: count(dir, 'curls'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// The stub has to be doing something, or every case below passes for the wrong
// reason. This is the control: the same script against two different remotes
// must reach two different numbers of pushes.
test('the harness actually drives the script', () => {
  assert.equal(run({ present: 0 }).pushes, 0, 'a remote with no ref should not be pushed to');
  assert.equal(run({ present: 1 }).pushes, 1);
  assert.equal(run({ present: 1, restores: 1 }).pushes, 2, 'a restored ref should be pushed away twice');
});

test('a normal merge: one push, one attempt, green', () => {
  const r = run({ present: 1 });
  assert.equal(r.code, 0);
  assert.match(r.log, new RegExp(`deleted ${BRANCH} \\(1 attempt\\(s\\)\\)`));
  assert.equal(r.pushes, 1);
});

// #48: converging and being satisfied are two decisions. The branch goes away
// AND the run reports that something wrote the ref back.
test('a ref the forge puts back is deleted again and the run still goes red', () => {
  const r = run({ present: 1, restores: 1 });
  assert.equal(r.code, 1, 'a restored ref must not end green');
  assert.match(r.log, new RegExp(`deleted ${BRANCH} \\(2 attempt\\(s\\)\\)`));
  assert.match(r.log, /was put back 1 time\(s\)/);
  assert.equal(r.pushes, 2);
});

test('the loop is bounded rather than fighting the forge forever', () => {
  const r = run({ present: 1, restores: 99 });
  assert.equal(r.code, 1);
  assert.match(r.log, /SURVIVED 4 delete attempts/);
  assert.equal(r.pushes, 4, 'the bound is four deletes, not four of something else');
});

test('a branch already gone is the desired end state, not a failure', () => {
  const r = run({ present: 0 });
  assert.equal(r.code, 0);
  assert.match(r.log, new RegExp(`${BRANCH} is already gone`));
  assert.equal(r.pushes, 0);
});

// #59, first defect. The restore window is the whole subject of this file, and
// a ref somebody else deleted seconds ago is sitting in it. One read of it used
// to be a conclusion, and the cheerful one.
test('a ref that reads as gone and comes back is converged on, not believed', () => {
  const r = run({ present: 0, reappearAfter: 1 });
  assert.equal(r.code, 1, 'a ref that came back must not end green');
  assert.match(r.log, /read as gone and was back/);
  assert.match(r.log, new RegExp(`deleted ${BRANCH} \\(2 attempt\\(s\\)\\)`));
  assert.equal(r.pushes, 1, 'the job issues one delete here; the other attempt was somebody else\'s');
});

// #59, second defect, and the one this repo keeps rediscovering in other
// shapes: a check that cannot fail. `git ls-remote` prints nothing when the ref
// is gone and prints nothing when it was refused.
test('a remote that will not answer fails the job instead of reading as gone', () => {
  const r = run({ present: 1, lsfail: 1 });
  assert.equal(r.code, 1);
  assert.match(r.log, /could not read the remote/);
  assert.doesNotMatch(r.log, /is already gone/, 'a failed read must never print the success line');
  assert.equal(r.pushes, 0, 'nothing should be pushed when the remote cannot be read');
});

// #39: the fallback exists for a push that cannot run at all. It is allowed to
// fire, but it is never allowed to be the thing that decides the verdict - that
// is #172's finding, and #17's bug.
test('the API fallback fires on a refused push, and git still gives the verdict', () => {
  const r = run({ present: 1, pushfail: 1, restores: 0 });
  assert.ok(r.curls > 0, 'a refused push should fall back to the API');
  assert.match(r.log, /falling back to the API/);
  assert.equal(r.code, 1, 'the ref is still there, so the run is red whatever the API said');
  assert.match(r.log, /SURVIVED 4 delete attempts/);
});

// The tick and the tally have to agree about the same run. #59 had to reason
// this out by hand: without seeding the attempt count, the gone-then-back case
// exits non-zero while classifyLog files it under clean.
//
// Green means the tally reports no trouble - not that it counts the run as a
// delete, because a branch that was already gone is a green run with nothing
// deleted. Red means the tally must not call it clean, and must not file it
// under the runs that had nothing to do either.
test('every run classifies the way its exit code says it should', () => {
  const cases = [
    ['clean', { present: 1 }, 0],
    ['restored', { present: 1, restores: 1 }, 1],
    ['gave up', { present: 1, restores: 99 }, 1],
    ['already gone', { present: 0 }, 0],
    ['gone then back', { present: 0, reappearAfter: 1 }, 1],
    ['unreadable', { present: 1, lsfail: 1 }, 1],
  ];
  for (const [name, opts, expected] of cases) {
    const r = run(opts);
    assert.equal(r.code, expected, `${name}: exit code`);
    const c = classifyLog(r.log);
    assert.notEqual(c.outcome, 'unknown', `${name}: the tally does not recognise this run's last line`);
    const s = summarise([c]);
    if (expected === 0) {
      assert.equal(s.retried.length + s.failed.length + s.unreadable.length, 0,
        `${name}: the job exited 0 and the tally reports trouble`);
    } else {
      assert.equal(s.clean, 0, `${name}: the job exited ${r.code} and the tally counts it clean`);
      assert.equal(s.quiet, 0, `${name}: the job exited ${r.code} and the tally files it under nothing to do`);
    }
  }
});
