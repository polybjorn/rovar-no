// npm run preview:all
//
// Republishes the one preview that keeps its address while branches come and
// go: `http://hypervisor.pebblecove.net:8455/rovar-no/preview-all/`, which is
// main with every unmerged branch on origin merged on top. A preview is a
// snapshot, so rerun this after a push; the address stays the same.
//
// It builds in a throwaway worktree, so the checkout it runs from is left
// alone. A branch that does not merge cleanly onto the others is skipped and
// named, rather than failing the whole preview.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SITE } from './preview-core.mjs';

const NAME = 'preview-all';
const repo = resolve(import.meta.dirname, '..');
const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const ok = (args, cwd) => spawnSync('git', args, { cwd, stdio: 'ignore' }).status === 0;

git(['fetch', '--prune', '--quiet', 'origin']);
const branches = git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/'])
  .split('\n')
  .filter((ref) => ref && !['origin', 'origin/HEAD', 'origin/main', `origin/herd/${NAME}`].includes(ref))
  .filter((ref) => !ok(['merge-base', '--is-ancestor', ref, 'origin/main'], repo));

const dir = join(mkdtempSync(join(tmpdir(), 'preview-all-')), 'site');
git(['worktree', 'add', '--quiet', '--detach', dir, 'origin/main']);
try {
  const skipped = [];
  for (const ref of branches) {
    if (ok(['merge', '--quiet', '--no-edit', ref], dir)) continue;
    ok(['merge', '--abort'], dir);
    skipped.push(ref);
  }
  symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));

  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { cwd: dir, stdio: 'inherit', env: { ...process.env, BRANCH: NAME } });
    if (r.status !== 0) process.exit(r.status ?? 1);
  };
  run(process.execPath, ['scripts/build-preview.mjs']);
  run('site-preview', ['publish', SITE, 'dist', NAME]);

  console.log(`\npreview:all: main + ${branches.length - skipped.length} branch(es)`);
  for (const ref of branches) console.log(`  ${skipped.includes(ref) ? 'SKIPPED, conflicts' : 'merged'}  ${ref}`);
} finally {
  git(['worktree', 'remove', '--force', dir]);
}
