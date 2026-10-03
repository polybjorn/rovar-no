// npm run preview:all
//
// Asks the host for the combined preview now rather than at its next tick:
// `http://hypervisor.pebblecove.net:8455/rovar-no/all/`, main with every open
// PR into main merged on top. The host builds it itself (nixfleet's
// `site-preview combined`, on a timer every few minutes) whenever main or a
// PR head moves, so this is only for not waiting. It rebuilds nothing when
// nothing moved, and a set that failed to build is retried on the next push,
// not by rerunning this.
//
// It used to merge every unmerged branch and publish the result as
// /rovar-no/preview-all/ itself; site-preview stopped taking a preview name
// (it names a preview by the branch its directory is on) and builds the
// combined one on its own, so that copy was a second, staler preview (#133).

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { SITE } from './preview-core.mjs';

const repo = resolve(import.meta.dirname, '..');
const run = spawnSync('site-preview', ['combined', SITE, repo], { stdio: 'inherit' });
if (run.error) {
  console.error(`preview:all: cannot run site-preview (${run.error.message}); it exists on the hypervisor only`);
  process.exit(2);
}
process.exit(run.status ?? 1);
