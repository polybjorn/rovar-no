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

// Every `node-version:` in the workflow, so a file that grew a second job with
// its own pin is an error rather than a silent read of whichever came first.
const pins = /^[^\S\n]*node-version:[^\S\n]*(.+?)[^\S\n]*$/gm;

// `${{ ... }}` is the shape deploy.yml takes once #12 moves the pin into
// .nvmrc and reads it from there. The number is then in .nvmrc, so that is
// where to look - a check that shrugged at an expression would go quietly
// green on exactly the change it exists to watch.
export const deployMajor = (workflowYaml, nvmrc = null) => {
  const found = [...workflowYaml.matchAll(pins)].map((m) => m[1].replace(/^['"]|['"]$/g, '').trim());
  if (found.length === 0) throw new Error('no node-version: in the deploy workflow');
  if (found.length > 1) throw new Error(`${found.length} node-version: pins in the deploy workflow: ${found.join(', ')}`);
  const [pin] = found;
  if (pin.includes('${{')) {
    if (nvmrc === null) throw new Error(`the deploy pin is the expression ${pin} and there is no .nvmrc to resolve it against`);
    const fromFile = major(nvmrc);
    if (fromFile === null) throw new Error(`.nvmrc holds no version number: ${nvmrc.trim()}`);
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
