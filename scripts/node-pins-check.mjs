// npm run pins:check
//
// Compares the node major this is running on against the pin in
// .github/workflows/deploy.yml and the floor in package.json. Run as a step in
// .forgejo/workflows/ci.yml, where "the node this is running on" is the gate's
// own node and the number reaches the log as a measurement instead of a
// comment.
//
// It lives entirely under .forgejo/ and scripts/ on purpose: it reads
// deploy.yml but never edits it, so it does not touch the push mirror that
// blocks #12.
//
// Exit codes: 0 agreed (or a tolerated skew), 1 the deploy pin is below the
// floor, 2 the check could not tell - a missing file or a pin it cannot parse
// is a failure, because a check that cannot read its inputs going green is the
// failure mode this exists to avoid.

import { readFileSync, existsSync } from 'node:fs';
import { runnerMajor, deployMajor, floorMajor, verdict } from './node-pins-core.mjs';

const DEPLOY = '.github/workflows/deploy.yml';

const read = (path) => {
  if (!existsSync(path)) {
    console.error(`${path} is not there. Run this from the repository root.`);
    process.exit(2);
  }
  return readFileSync(path, 'utf8');
};

// Whatever file the deploy workflow points at, or null when it is missing -
// the core decides whether a missing one is fatal, because that depends on
// which of the three pin shapes it found.
const readIfThere = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null);

let runner, deploy, floor;
try {
  runner = runnerMajor();
  deploy = deployMajor(read(DEPLOY), readIfThere);
  floor = floorMajor(JSON.parse(read('package.json')));
} catch (err) {
  console.error(`Could not compare the node pins: ${err.message}`);
  process.exit(2);
}

const result = verdict({ runner, deploy, floor });

const row = (where, what) => console.log(`  ${where.padEnd(DEPLOY.length + 2)}${what}`);
row('gate (this runner)', `node ${runner}`);
row(DEPLOY, `node ${deploy}`);
row('package.json engines', `node >=${floor}`);
console.log('');
for (const note of result.notes) console.log(`note: ${note}`);

if (result.ok) {
  console.log(`ok: ${result.summary}`);
  process.exit(0);
}

console.error(`Node pins disagree in a way that can break the build: ${result.summary}`);
console.error(`Raise ${DEPLOY} to a major that clears the floor, or lower the floor to one it clears.`);
process.exit(1);
