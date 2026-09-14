import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runnerMajor, deployMajor, floorMajor, verdict } from '../scripts/node-pins-core.mjs';

const yaml = (pin) => `jobs:\n  build:\n    steps:\n      - uses: actions/setup-node@v7\n        with:\n          node-version: ${pin}\n          cache: npm\n`;

test('reads the deploy pin in the shapes a workflow writes it', () => {
  assert.equal(deployMajor(yaml('22')), 22);
  assert.equal(deployMajor(yaml("'22'")), 22);
  assert.equal(deployMajor(yaml('"22.12.0"')), 22);
  assert.equal(deployMajor(yaml('22.x')), 22);
});

test('resolves an expression pin against .nvmrc, which is the shape #12 lands', () => {
  assert.equal(deployMajor(yaml('${{ steps.node.outputs.version }}'), '24.2.0\n'), 24);
  assert.throws(() => deployMajor(yaml('${{ steps.node.outputs.version }}')), /no .nvmrc/);
  assert.throws(() => deployMajor(yaml('${{ steps.node.outputs.version }}'), 'lts/*\n'), /no version number/);
});

test('refuses to guess rather than going green on an unreadable file', () => {
  assert.throws(() => deployMajor('jobs:\n  build:\n    steps: []\n'), /no node-version/);
  assert.throws(() => deployMajor(yaml('22') + yaml('24')), /2 node-version/);
  assert.throws(() => deployMajor(yaml('lts/*')), /no version number/);
  assert.throws(() => floorMajor({}), /no engines.node/);
  assert.throws(() => floorMajor({ engines: { node: '*' } }), /no version number/);
});

test('reads the floor out of a range', () => {
  assert.equal(floorMajor({ engines: { node: '>=22.12.0' } }), 22);
  assert.equal(floorMajor({ engines: { node: '^24.0.0' } }), 24);
});

test('runnerMajor reads the running node by default', () => {
  assert.equal(runnerMajor(), Number(process.versions.node.split('.')[0]));
  assert.equal(runnerMajor('24.19.0'), 24);
});

test('a skew that still clears the floor is tolerated, and said out loud', () => {
  const r = verdict({ runner: 24, deploy: 22, floor: 22 });
  assert.equal(r.ok, true);
  assert.match(r.notes.join(' '), /gate builds on 24 and the deploy builds on 22/);
});

test('a skew below the floor fails', () => {
  const r = verdict({ runner: 24, deploy: 22, floor: 24 });
  assert.equal(r.ok, false);
  assert.match(r.summary, /below the 24 floor/);
});

test('agreement passes with nothing to report', () => {
  const r = verdict({ runner: 22, deploy: 22, floor: 22 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.notes, []);
});

test('a gate below the floor is reported but does not fail, per the decision on #26', () => {
  const r = verdict({ runner: 20, deploy: 22, floor: 22 });
  assert.equal(r.ok, true);
  assert.match(r.notes.join(' '), /runner's 20 is below the 22 floor/);
});

// The check exists because these three drifted apart unnoticed. If the repo's
// own files stop being readable by it, that is the same silence again.
test('this repository\'s own files parse', () => {
  const deploy = deployMajor(readFileSync('.github/workflows/deploy.yml', 'utf8'));
  const floor = floorMajor(JSON.parse(readFileSync('package.json', 'utf8')));
  assert.ok(Number.isInteger(deploy) && deploy >= 20);
  assert.ok(Number.isInteger(floor) && floor >= 20);
});
