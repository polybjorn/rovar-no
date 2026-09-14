// The parts of the node-pin check that read nothing, kept separate so
// test/node-pins.test.mjs can cover them. Same split as link-check-core.mjs:
// the parsing is where the bugs are, and it is the half that can be tested
// without a runner to measure.
//
// Three numbers have to agree, and until #26 nothing in the repo compared
// them:
//
//   the forge runner   the gate that blocks a pull request
//   deploy.yml         the build that publishes the site
//   package.json       the floor both have to clear
//
// The rule is deliberately narrower than "they must match" (#26, option 4).
// Requiring a match would have turned CI red on the next push and kept it red
// until #12 lands, which is blocked on #5, which needs Bjørn. So a skew alone
// is reported and tolerated; it fails only once the deploy pin drops below the
// floor, which is the point where the divergence can actually break the build.

const major = (value) => {
  const hit = /\d+/.exec(String(value));
  return hit ? Number(hit[0]) : null;
};

export const runnerMajor = (version = process.versions.node) => major(version);

// Every `node-version:` and `node-version-file:` in the workflow, so a file
// that grew a second job with its own pin is an error rather than a silent read
// of whichever came first.
const pins = /^[^\S\n]*node-version:[^\S\n]*(.+?)[^\S\n]*$/gm;
const pinFiles = /^[^\S\n]*node-version-file:[^\S\n]*(.+?)[^\S\n]*$/gm;

const unquote = (v) => v.replace(/^['"]|['"]$/g, '').trim();
const oneOf = (yaml, re, what) => [...yaml.matchAll(re)].map((m) => unquote(m[1]));

// readFile(path) -> contents, or null when it is not there.
//
// Three shapes reach this, and a check that understood only the first would go
// blind on exactly the change it exists to watch:
//
//   node-version: 22                              an inline pin
//   node-version-file: .nvmrc                     what actions/setup-node takes
//   node-version: ${{ steps.node.outputs.version }}   read from a step
//
// The third is what a workflow does when its action has no node-version-file
// input - withastro/action, which lokalverket-no and polybjorn-en use - and the
// number is then in .nvmrc anyway, so that is where to look.
export const deployMajor = (workflowYaml, readFile = () => null) => {
  const inline = oneOf(workflowYaml, pins);
  const files = oneOf(workflowYaml, pinFiles);
  const total = inline.length + files.length;
  if (total === 0) throw new Error('no node-version: or node-version-file: in the deploy workflow');
  if (total > 1) throw new Error(`${total} node pins in the deploy workflow: ${[...inline, ...files].join(', ')}`);

  if (files.length === 1) {
    const path = files[0];
    const body = readFile(path);
    if (body === null) throw new Error(`the deploy workflow reads ${path} and it is not there`);
    const fromFile = major(body);
    if (fromFile === null) throw new Error(`${path} holds no version number: ${body.trim()}`);
    return fromFile;
  }

  const [pin] = inline;
  if (pin.includes('${{')) {
    const body = readFile('.nvmrc');
    if (body === null) throw new Error(`the deploy pin is the expression ${pin} and there is no .nvmrc to resolve it against`);
    const fromFile = major(body);
    if (fromFile === null) throw new Error(`.nvmrc holds no version number: ${body.trim()}`);
    return fromFile;
  }
  const fromPin = major(pin);
  if (fromPin === null) throw new Error(`the deploy pin holds no version number: ${pin}`);
  return fromPin;
};

export const floorMajor = (pkg) => {
  const declared = pkg?.engines?.node;
  if (!declared) throw new Error('package.json declares no engines.node');
  const floor = major(declared);
  if (floor === null) throw new Error(`engines.node holds no version number: ${declared}`);
  return floor;
};

export const verdict = ({ runner, deploy, floor }) => {
  const notes = [];
  // Not a failure, by the decision on #26: the gate running below the floor is
  // a different fault from the two pins diverging, and folding it in here
  // would widen a check that was chosen for being narrow. It is printed so it
  // is in the log rather than in nobody's head.
  if (runner < floor) notes.push(`the runner's ${runner} is below the ${floor} floor package.json declares`);
  if (runner === deploy) return { ok: true, notes, summary: `gate and deploy both build on ${runner}` };
  notes.push(`the gate builds on ${runner} and the deploy builds on ${deploy}`);
  if (deploy >= floor) {
    return {
      ok: true,
      notes,
      summary: `${runner} and ${deploy} differ, and ${deploy} still clears the ${floor} floor`,
    };
  }
  return {
    ok: false,
    notes,
    summary: `the deploy builds on ${deploy}, below the ${floor} floor package.json declares, while the gate builds on ${runner}`,
  };
};
