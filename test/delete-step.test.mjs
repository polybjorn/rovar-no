// The delete step's own control flow, run rather than read.
//
// This file has been rewritten seven times and the script inside it had never
// been executed by anything except the forge until #62. The suite covered the
// parser that reads its logs and one glob out of the sweep; the step's
// branching - the already-gone path, the fallback, the exit codes - was only
// ever exercised by a real merge.
//
// That is the wrong way round for this particular script, because of the thing
// #44 keeps running into: A CLEAN RUN PRINTS THE SAME LINE UNDER EVERY VERSION
// OF THIS JOB. `deleted <branch> (1 attempt(s))` and a green tick is what the
// one-shot code, #45's loop, #48's red-on-restore and the preserve-the-specimen
// shape below all produce when the forge does not interfere. So a merge
// confirms almost nothing, and the paths that matter are the ones no merge can
// be made to produce: a ref that comes back, a remote that will not answer.
//
// Same shape as sweep-glob.test.mjs: read the real thing out of the workflow
// and run THAT. Asserting on the text of the file would pass on a script that
// could not run at all.
//
// #62, and #65 for the specimen rules.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
  assert.match(src, /KEPT as a specimen/, 'the extracted block is missing the preserve path');
  return src;
};

// A stub git driven by a state directory. `present` is whether the ref is on
// the remote, `restores` how many pushes get undone by the forge before one
// sticks, `reappear_after` how many reads happen before an absent ref comes
// back, `lsfail`, `pushfail` and `markerfail` make those commands refuse.
//
// DELETE PUSHES AND MARKER PUSHES ARE COUNTED SEPARATELY, and that separation
// is the point of this file now. `git push <remote> --delete <ref>` removes the
// branch and the reflog with it; `git push <remote> <sha>:refs/specimens/...`
// writes a marker and must not touch the branch at all. A stub that counted
// both as "a push" would let a script that deleted the specimen pass the test
// that exists to stop exactly that.
//
// `#!/usr/bin/env bash`, and bash invoked off PATH below: the hypervisor these
// agents run on has no /bin/bash, so a hardcoded shebang exits 127 there while
// passing in CI. Same trap as the repo's own check-attribution.sh.
const STUB_GIT = `#!/usr/bin/env bash
ST="\${ST:?}"
case "$1" in
  # A real repository, not a mkdir. The step's own comment explains why it
  # needs one at all (#39), and since #67 it also runs \`git pack-objects\`
  # there: a faked init left that with nowhere to stand, and the empty pack
  # came back empty in a way only the real-receive-pack test below noticed.
  init) shift; while [ $# -gt 1 ]; do shift; done; exec "\${REAL_GIT:?}" init -q "$1" ;;
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
    [ "$(cat "$ST/present")" = 1 ] && printf '%s\\trefs/heads/${BRANCH}\\n' "$(cat "$ST/sha")"
    exit 0 ;;
  push)
    if [ "\${3:-}" = "--delete" ]; then
      echo push >> "$ST/pushes"
      if [ "$(cat "$ST/pushfail")" = 1 ]; then echo "remote: permission denied" >&2; exit 1; fi
      echo " - [deleted]         ${BRANCH}" >&2
      r=$(cat "$ST/restores")
      if [ "$r" -gt 0 ]; then echo $((r - 1)) > "$ST/restores"; else echo 0 > "$ST/present"; fi
      exit 0
    fi
    printf '%s\\n' "\${3:-}" >> "$ST/markers"
    if [ "$(cat "$ST/markerfail")" = 1 ]; then echo "remote: denied" >&2; exit 1; fi
    exit 0 ;;
  pack-objects)
    # Delegated to the real git rather than faked. What it returns goes into the
    # request #67's probe builds, and a test below feeds that request to a real
    # \`git receive-pack\`. A stubbed pack would let that test pass over a request
    # no server would take.
    exec "\${REAL_GIT:?}" "$@" ;;
esac
echo "stub git: unhandled $*" >&2; exit 99
`;

const STUB_SLEEP = '#!/usr/bin/env bash\nexit 0\n';

// Two callers now, wanting different things on stdout. The API fallback and the
// tally comment read an HTTP status; #67's ref-lock probe reads a receive-pack
// report. The probe is also the only one that POSTs a body, and that body is
// kept so a test can check a real server would take it.
const STUB_CURL = `#!/usr/bin/env bash
ST="\${ST:?}"
printf "%s\\n" "$*" >> "$ST/curls"
case "$*" in
  *git-receive-pack*)
    prev=
    for a in "$@"; do
      case "$a" in
        --data-binary) prev=data ;;
        @*) [ "$prev" = data ] && cp "\${a#@}" "$ST/rp-body.bin"; prev= ;;
        *) prev= ;;
      esac
    done
    cat "$ST/rp_reply"
    exit 0 ;;
esac
printf 500
`;

// Resolved once, here, because every run below puts the stub directory first on
// PATH and the stub needs a way back to the real thing.
const REAL_GIT = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();

const lines = (dir, name) => {
  try { return readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean); } catch { return []; }
};

// Runs the real step against the stubs and returns what a job log would show.
const run = ({ present = 1, restores = 0, reappearAfter = -1, lsfail = 0, pushfail = 0, markerfail = 0, tallyIssue = '', sha = 'deadbeef', rpReply = '' } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'delete-step-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    for (const [name, src] of [['git', STUB_GIT], ['sleep', STUB_SLEEP], ['curl', STUB_CURL]]) {
      const p = join(bin, name);
      writeFileSync(p, src);
      chmodSync(p, 0o755);
    }
    const state = { present, restores, reappear_after: reappearAfter, lsfail, pushfail, markerfail, sha, rp_reply: rpReply };
    for (const [k, v] of Object.entries(state)) writeFileSync(join(dir, k), `${v}\n`);
    for (const f of ['reads', 'pushes', 'markers', 'curls']) writeFileSync(join(dir, f), '');

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
        TALLY_ISSUE: tallyIssue,
        REAL_GIT,
      },
    });
    return {
      code: r.status,
      log: `${r.stdout}${r.stderr}`,
      pushes: lines(dir, 'pushes').length,
      markers: lines(dir, 'markers'),
      reads: lines(dir, 'reads').length,
      curls: lines(dir, 'curls'),
      request: (() => { try { return readFileSync(join(dir, 'rp-body.bin')); } catch { return null; } })(),
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
  assert.equal(run({ present: 1, restores: 1 }).markers.length, 1, 'a restored ref should be marked');
});

test('a normal merge: one delete, no specimen, green', () => {
  const r = run({ present: 1 });
  assert.equal(r.code, 0);
  assert.match(r.log, new RegExp(`deleted ${BRANCH} \\(1 attempt\\(s\\)\\)`));
  assert.equal(r.pushes, 1);
  assert.deepEqual(r.markers, [], 'nothing was restored, so nothing should be marked');
});

// THE ONE THIS FILE EXISTS FOR. #65: deleting a ref destroys its reflog, which
// is the only evidence separating #44's two faults - measured on git 2.54.0 and
// confirmed by the 2026-09-15 specimen, whose reflog held exactly one entry
// because its own earlier push and delete had gone with the ref.
//
// The convergence loop this replaced deleted the restored ref about five
// seconds later. It converged correctly and destroyed the evidence on its way,
// then went red asking somebody to investigate. So the assertion is not on the
// wording of the verdict, it is on the PUSH COUNT: exactly one delete ever
// reaches the remote, no matter how many times the ref comes back.
test('a ref the forge puts back is kept, not deleted again', () => {
  const r = run({ present: 1, restores: 1 });
  assert.equal(r.code, 1, 'a restored ref must not end green');
  assert.match(r.log, new RegExp(`${BRANCH} KEPT as a specimen`));
  assert.equal(r.pushes, 1, 'the restored ref must never be deleted a second time - that erases the reflog');
  assert.doesNotMatch(r.log, /deleted herd\/x \(/, 'a kept specimen must not also claim the branch is gone');
});

test('a ref that keeps coming back is still only ever deleted once', () => {
  const r = run({ present: 1, restores: 99 });
  assert.equal(r.code, 1);
  assert.match(r.log, /KEPT as a specimen/);
  assert.equal(r.pushes, 1, 'no bound to reach, because the job no longer fights the forge');
});

test('the kept branch is marked so the sweep leaves it alone', () => {
  const r = run({ present: 1, restores: 1 });
  assert.equal(r.markers.length, 1);
  assert.match(r.markers[0], new RegExp(`^deadbeef:refs/specimens/\\d{4}-\\d{2}-\\d{2}/${BRANCH}$`),
    'the marker must carry a sha, a date the sweep can expire, and the branch name');
});

// `git push <remote> :refs/x` with nothing on the left of the colon is the
// DELETE refspec. The sha comes from an ls-remote that this whole file exists
// because it can come back empty, so an unguarded "${sha}:refs/..." would turn
// the line that preserves the specimen into one that removes a ref.
test('an empty sha never becomes a delete refspec', () => {
  const r = run({ present: 1, restores: 1, lsfail: 0, markerfail: 1 });
  for (const m of r.markers) {
    assert.doesNotMatch(m, /^:/, 'a marker refspec with an empty left side is a delete');
  }
  assert.match(r.log, /could not mark/, 'a refused marker must be reported, not swallowed');
  assert.equal(r.code, 1);
});

test('a branch already gone is the desired end state, not a failure', () => {
  const r = run({ present: 0 });
  assert.equal(r.code, 0);
  assert.match(r.log, new RegExp(`${BRANCH} is already gone`));
  assert.equal(r.pushes, 0);
});

// #59, first defect, and the rarer specimen of the two: a delete this job never
// issued was undone, so the writer cannot be reacting to anything this job
// pushed. #59 converged on it; #65 keeps it, for the same reflog reason, and
// here the job must not push a delete at all.
test('a ref that reads as gone and comes back is kept, and never deleted', () => {
  const r = run({ present: 0, reappearAfter: 1 });
  assert.equal(r.code, 1, 'a ref that came back must not end green');
  assert.match(r.log, /read as gone and was back/);
  assert.match(r.log, /KEPT as a specimen/);
  assert.equal(r.pushes, 0, 'this job issued no delete here, and must not issue one now');
  assert.equal(r.markers.length, 1);
});

// #67. Every other check in this job asks `git ls-remote`, which reads the ref
// ADVERTISEMENT the server sends at the start of a connection - a report about
// the refs, not the refs. #172 is this repo's own case of a reporting surface
// being wrong, on the API's branch list, and a kept specimen is the one moment
// where nobody will be able to go and look at the disk instead.
//
// The probe asks the server to take the ref lock: a receive-pack command whose
// old and new values are both the sha just read is a no-op it can only accept
// if the ref is there at that value.
//
// THE POINT OF THESE THREE IS THAT IT CHANGES NOTHING. Not the verdict, not the
// push count, not the marker. A probe that could flip a red run to green, or
// that pushed anything, would be a worse bug than the blind spot it closes.
for (const [name, reply] of [
  ['the ref is there', 'unpack ok\nok refs/heads/herd/x\n'],
  ['the ref is not there', 'unpack ok\nng refs/heads/herd/x reference does not exist\n'],
  ['the ref moved again', 'unpack ok\nng refs/heads/herd/x incorrect old value provided\n'],
  ['the forge did not answer', ''],
]) {
  test(`the ref-lock probe decides nothing when ${name}`, () => {
    const r = run({ present: 1, restores: 1, rpReply: reply });
    assert.equal(r.code, 1, 'the verdict is made before the probe runs and the probe cannot move it');
    assert.match(r.log, /KEPT as a specimen/);
    assert.equal(r.pushes, 1, 'the probe must not push anything, least of all a second delete');
    assert.equal(r.markers.length, 1, 'and the specimen is still marked for the sweep');
  });
}

test('the probe reports which of the four answers it got', () => {
  assert.match(run({ present: 1, restores: 1, rpReply: 'unpack ok\nok refs/heads/herd/x\n' }).log,
    /the forge confirms herd\/x is on disk/);
  assert.match(run({ present: 1, restores: 1, rpReply: 'unpack ok\nng refs/heads/herd/x reference does not exist\n' }).log,
    /those two surfaces disagree/);
  assert.match(run({ present: 1, restores: 1, rpReply: 'unpack ok\nng refs/heads/herd/x incorrect old value provided\n' }).log,
    /moved again between the two reads/);
  assert.match(run({ present: 1, restores: 1, rpReply: '' }).log,
    /could not ask the forge/, 'a probe with no answer says so rather than implying one');
});

// THE ONE THAT CHECKS THE REQUEST IS REAL. Everything above runs against a stub
// that answers whatever it is told to, so on its own it would pass over a
// malformed request no server would take - the pkt-line length is computed in
// shell and is exactly the kind of thing that is wrong by one byte. So the
// bytes the step actually built are fed to a real `git receive-pack`, against a
// real bare repository, in all three states of the ref.
//
// It also asserts what the probe is allowed to cost: the ref and its reflog are
// unchanged afterwards. #65's finding is that the reflog is the scarce thing,
// and a probe that appended to it would be taking the evidence it was added to
// protect.
test('the request the step builds is one a real receive-pack answers, and it writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'delete-step-srv-'));
  const bare = join(dir, 'srv.git');
  const git = (args, opts = {}) => spawnSync('git', args, {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    ...opts,
  });
  try {
    git(['init', '-q', '--bare', bare]);
    git(['-C', bare, 'config', 'core.logAllRefUpdates', 'true']);
    // commit-tree rather than commit: it writes an object without running a
    // hook, and this host has a global hooksPath.
    const tree = git(['-C', bare, 'hash-object', '-t', 'tree', '-w', '--stdin'], { input: '' }).stdout.trim();
    const sha = git(['-C', bare, 'commit-tree', tree, '-m', 'x'], { input: '' }).stdout.trim();
    const other = git(['-C', bare, 'commit-tree', tree, '-m', 'y'], { input: '' }).stdout.trim();
    assert.notEqual(sha, other);
    git(['-C', bare, 'update-ref', 'refs/heads/herd/x', sha]);

    const r = run({ present: 1, restores: 1, sha, rpReply: 'unpack ok\nok refs/heads/herd/x\n' });
    assert.ok(r.request, 'the probe should have POSTed a request');
    assert.ok(r.request.includes(`${sha} ${sha} refs/heads/herd/x`),
      'the command should be a no-op update on the sha ls-remote advertised');
    assert.ok(r.request.includes('PACK'), 'the protocol wants a pack even when there is nothing to send');

    const ask = () => spawnSync('git', ['receive-pack', bare], { input: r.request }).stdout.toString('latin1');
    const value = () => git(['-C', bare, 'rev-parse', '--verify', '-q', 'refs/heads/herd/x']).stdout.trim();
    const reflog = () => git(['-C', bare, 'reflog', 'show', 'refs/heads/herd/x']).stdout.trim();

    const before = reflog();
    assert.match(ask(), /ok refs\/heads\/herd\/x/, 'the ref is there at that sha, so the server accepts the no-op');
    assert.equal(value(), sha, 'and the ref is untouched');
    assert.equal(reflog(), before, 'and nothing was appended to the reflog');

    git(['-C', bare, 'update-ref', 'refs/heads/herd/x', other]);
    assert.match(ask(), /ng refs\/heads\/herd\/x incorrect old value/, 'a ref at another sha is refused');
    assert.equal(value(), other, 'and left where it was');

    git(['-C', bare, 'update-ref', '-d', 'refs/heads/herd/x']);
    assert.match(ask(), /ng refs\/heads\/herd\/x reference does not exist/,
      'and an advertised ref the server does not have is the answer this probe exists for');
    assert.equal(value(), '', 'the probe must not create the ref it failed to find');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the probe answer reaches the tracking issue, not just the log', () => {
  const r = run({ present: 1, restores: 1, tallyIssue: '44', rpReply: 'unpack ok\nok refs/heads/herd/x\n' });
  const comment = r.curls.find((c) => c.includes('/issues/44/comments'));
  assert.ok(comment, 'a kept specimen still comments');
  assert.ok(comment.includes('the forge confirms'),
    'the comment is what a reader sees first, so the probe answer belongs in it');
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
  assert.ok(r.curls.some((c) => c.includes('DELETE')), 'a refused push should fall back to the API');
  assert.match(r.log, /falling back to the API/);
  assert.equal(r.code, 1, 'the ref is still there, so the run is red whatever the API said');
  assert.match(r.log, /KEPT as a specimen/);
});

// The notice has to come from the job. `retries:check` runs at 05:13 and the
// sweep at 04:53, so a tally reporting a live specimen is always twenty minutes
// too late by construction.
test('a kept specimen announces itself on the tracking issue, when it has one', () => {
  const withIssue = run({ present: 1, restores: 1, tallyIssue: '44' });
  assert.ok(withIssue.curls.some((c) => c.includes('/issues/44/comments')),
    'a kept specimen should comment on the tracking issue');

  const without = run({ present: 1, restores: 1 });
  assert.equal(without.curls.filter((c) => c.includes('/comments')).length, 0,
    'no tally issue configured means no comment attempted');
  assert.equal(without.code, 1, 'and the verdict is the same either way');
});

test('a forge that will not take the comment does not change the verdict', () => {
  const r = run({ present: 1, restores: 1, tallyIssue: '44' });
  assert.equal(r.code, 1);
  assert.match(r.log, /KEPT as a specimen/, 'the log is the record when the comment fails');
});

// The tick and the tally have to agree about the same run. #59 had to reason
// this out by hand; now every path is checked against the parser.
//
// Green means the tally reports no trouble - not that it counts the run as a
// delete, because a branch that was already gone is a green run with nothing
// deleted. Red means the tally must not call it clean, and must not file it
// under the runs that had nothing to do either.
test('every run classifies the way its exit code says it should', () => {
  const cases = [
    ['clean', { present: 1 }, 0],
    ['kept', { present: 1, restores: 1 }, 1],
    ['kept repeatedly', { present: 1, restores: 99 }, 1],
    ['already gone', { present: 0 }, 0],
    ['gone then back', { present: 0, reappearAfter: 1 }, 1],
    ['unreadable', { present: 1, lsfail: 1 }, 1],
    ['push refused', { present: 1, pushfail: 1 }, 1],
  ];
  for (const [name, opts, expected] of cases) {
    const r = run(opts);
    assert.equal(r.code, expected, `${name}: exit code`);
    const c = classifyLog(r.log);
    assert.notEqual(c.outcome, 'unknown', `${name}: the tally does not recognise this run's last line`);
    const s = summarise([c]);
    if (expected === 0) {
      assert.equal(s.retried.length + s.failed.length + s.unreadable.length + s.preserved.length, 0,
        `${name}: the job exited 0 and the tally reports trouble`);
    } else {
      assert.equal(s.clean, 0, `${name}: the job exited ${r.code} and the tally counts it clean`);
      assert.equal(s.quiet, 0, `${name}: the job exited ${r.code} and the tally files it under nothing to do`);
    }
  }
});
