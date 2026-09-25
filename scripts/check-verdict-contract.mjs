// npm run verdict:check
//
// Asserts that the delete job still prints the lines this repo's tally parses.
// Run daily from merge-audit.yml, alongside the tally itself: that step counts
// the verdicts, this one checks the verdicts are still the ones it can count.
//
// Needs the network and nothing else. The action lives in bjorn/ci-actions,
// which is public - its own README requires that, because a job's automatic
// token is answered 403 on any other private repo - so TOKEN is optional here
// and only sent when it is set. That is also why this is not in `npm test`:
// the test suite runs from hosts with no forge credential and must stay
// offline, so the half of the contract that needs a forge lives here.
//
// Exit codes are three, not two, and the third is the point. 0 the wordings
// hold, 1 one is gone, 2 the question could not be asked. A fetch that failed
// is not a contract that holds - the same lesson the delete job learned about
// `git ls-remote` in #59, in the place where getting it wrong means a green
// tick over an unasked question.

import { readFileSync } from 'node:fs';
import { CONTRACT, actionPin, missingFrom, contractLines } from './verdict-contract-core.mjs';

const WORKFLOW = '.forgejo/workflows/delete-merged-branch.yml';
const FILE = 'delete.sh';

const die = (...lines) => {
  for (const l of lines) console.error(l);
  process.exit(2);
};

if (!CONTRACT.length) die('the verdict contract is empty, so this check would pass whatever the action printed');

let pin;
try {
  pin = actionPin(readFileSync(WORKFLOW, 'utf8'));
} catch (e) {
  die(`${WORKFLOW}: ${e.message}`);
}

const url = `${pin.base}/api/v1/repos/${pin.owner}/${pin.repo}/contents/${pin.path}/${FILE}?ref=${encodeURIComponent(pin.ref)}`;
const headers = process.env.TOKEN ? { Authorization: `token ${process.env.TOKEN}` } : {};

let res;
try {
  res = await fetch(url, { headers });
} catch (e) {
  die(`could not reach ${pin.base} to read ${pin.path}/${FILE}@${pin.ref}: ${e.message}`);
}
if (!res.ok) die(`GET ${pin.owner}/${pin.repo} ${pin.path}/${FILE}@${pin.ref}: ${res.status} ${res.statusText}`);

const body = await res.json();
if (typeof body?.content !== 'string' || body.encoding !== 'base64') {
  die(`the contents API did not answer with base64 content for ${pin.path}/${FILE}@${pin.ref}`);
}
const source = Buffer.from(body.content, 'base64').toString('utf8');
// A truncated or empty answer would report every wording missing, which reads
// as a five-alarm reword rather than as a bad read.
if (source.length < 1000) die(`${pin.path}/${FILE}@${pin.ref} came back ${source.length} bytes, which is too short to be the delete script`);

const missing = missingFrom(source);
for (const line of contractLines(missing, pin)) (missing.length ? console.error : console.log)(line);
process.exit(missing.length ? 1 : 0);
