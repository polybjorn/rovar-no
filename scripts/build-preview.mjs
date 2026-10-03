// npm run preview:build
//
// Builds this site for the fleet's preview server, which serves a branch from
// a subpath: `http://hypervisor.pebblecove.net:8455/rovar-no/<branch>/`.
//
// The base path has to be baked into the build and has to match the path the
// publisher will put it on, or the page renders with every asset missing. This
// derives it the way `site-preview` does and hands back the publish command.
// Every URL the site emits already goes through BASE_URL (src/i18n/routes.js,
// Layout.astro), so setting `base` is the whole job; polybjorn-en needs a
// second pass for hand-written root paths, and this site has none.
//
//   npm run preview:build              # base from the current branch
//   BRANCH=herd/other npm run preview:build

import { execFileSync, spawnSync } from 'node:child_process';
import { SITE, previewBase } from './preview-core.mjs';

const branch = process.env.BRANCH
  ?? execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();

if (!branch || branch === 'HEAD') {
  console.error('preview:build: cannot read a branch name; pass one as BRANCH=');
  process.exit(2);
}

const base = previewBase(branch);
const env = { ...process.env, PREVIEW_BASE: base };

console.log(`preview:build: building ${branch} for ${base}`);

// The same two steps `npm run build` runs (prebuild, then astro), each a node
// script, so run them with this node and no shell.
for (const args of [
  ['scripts/i18n-check.mjs', '--check'],
  ['node_modules/astro/bin/astro.mjs', 'build'],
]) {
  const run = spawnSync(process.execPath, args, { stdio: 'inherit', env });
  if (run.status !== 0) process.exit(run.status ?? 1);
}

console.log(`\npreview:build: publish it with\n  site-preview publish ${SITE} dist ${branch}`);
