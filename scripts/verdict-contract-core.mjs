// The delete job's verdict wordings, declared here because they are no longer
// written here. Kept network-free so test/verdict-contract.test.mjs can cover
// it, same split as sweep-freshness-core.mjs and merged-prs-core.mjs.
//
// The question this answers: does the job whose logs the tally parses still
// print the lines the tally looks for?
//
// Since #72 the delete step is bjorn/ci-actions/delete-merged-branch, so the
// wordings belong to another repo and this one only reads them.
// scripts/delete-retries-core.mjs classifies a run by matching the last line
// the job prints, so a reword over there lands every delete run here in the
// `unknown` bucket - and `unknown` is a count in a daily summary, not a red
// tick. delete-merged-branch.yml's header states that exposure and stops at
// stating it: "Both sides know it and neither can assert it." This is this
// side asserting it.
//
// TWO ASSERTIONS, AND THEY FAIL FOR DIFFERENT REASONS. The table below is one
// declaration read by both:
//
//   offline, in npm test   each sample classifies to the outcome it claims,
//                          which is a statement about OUR parser
//   daily, in merge-audit  each `shell` still appears in the action source at
//                          the ref delete-merged-branch.yml pins, which is a
//                          statement about THEIRS
//
// Splitting them that way is what keeps `npm test` offline. A test that fetched
// another repo would fail on a network blip and pass on a cached answer, and
// this repo's tests run from a host with no forge credentials at all.
//
// WHAT THIS CANNOT CATCH, said plainly because the gap is the interesting part:
// a verdict the action ADDS. Nothing here enumerates the action's output, so a
// new terminal line would go unmatched by the tally and unmentioned by this
// check, and the only signal would be the `unknown` count. Catching that needs
// the action to declare its own verdicts, which is its repo's call to make.

// As written in the action's delete.sh, variables and all, so the daily check
// can look for the string rather than for a shape. Each is the message text
// only - not the `echo` around it, which carries redirections that change
// without the wording changing.
//
// Every one of these is a line the action can EXIT on. The informational lines
// it prints on the way (the ref-lock probe's four answers, the specimen marker
// note, the API fallback) are deliberately absent: the tally reads a verdict,
// and adding non-verdicts here would make this fail on edits that cost nothing.
export const CONTRACT = [
  {
    outcome: 'deleted',
    shell: 'deleted $BRANCH (1 attempt(s))',
    note: 'the normal case, and the count stays in it although the action makes one attempt - see its own comment',
  },
  {
    outcome: 'preserved',
    shell: '$BRANCH KEPT as a specimen: $why',
    note: 'the event #44 is open for',
  },
  {
    outcome: 'unreadable',
    shell: 'git ls-remote could not read the remote, so nothing here can say whether $BRANCH is gone',
    note: 'a read that failed is not a ref that is gone',
  },
  {
    outcome: 'already-gone',
    shell: '$BRANCH is already gone',
    note: 'something else got there first, which is the desired end state',
  },
  {
    outcome: 'not-ours',
    shell: 'refusing: $BRANCH is not under $PREFIX, so this action will not touch it',
    // The one line whose sample is not a herd/ branch, because the whole
    // point of it is a branch that is not one.
    vars: { BRANCH: 'main' },
    note: "the action's belt against a caller who wires the job-level `if:` wrong; unreachable from this repo, which is why the tally had never noticed it reworded",
  },
];

// What the variables stand for when the line reaches a log. Only used to build
// the sample the offline test classifies - the daily check matches the
// unsubstituted string, because that is what is in the source.
const VARS = {
  BRANCH: 'herd/x',
  PREFIX: 'herd/',
  why: 'the forge put it back within 5s of a delete git accepted',
};

// A replacement FUNCTION rather than a string: `$'` and `$&` in a replacement
// string are substitution patterns, and one of these lines is nothing but
// dollar signs and prose.
export const sample = (shell, overrides = {}) => {
  const vars = { ...VARS, ...overrides };
  return String(shell).replace(/\$(\w+)/g, (whole, name) => {
    if (!(name in vars)) throw new Error(`no sample value for $${name} in: ${shell}`);
    return vars[name];
  });
};

export const sampleFor = (entry) => sample(entry.shell, entry.vars);

// Read the pin out of the workflow rather than repeating it here. A check that
// carried its own copy of the ref would keep passing against v1 after the job
// moved to v2, which is the failure this whole file exists to remove, one level
// up. Same reasoning as test/sweep-glob.test.mjs reading the glob out of the
// file it tests.
export const actionPin = (workflowText) => {
  const m = String(workflowText).match(/uses:\s*(\S*\/delete-merged-branch)@(\S+)/);
  if (!m) {
    throw new Error(
      'no `uses: .../delete-merged-branch@<ref>` in the delete job. Either it moved back to a `run:` block in this repo, ' +
        'in which case this check has nothing to check and should go, or the pin was reworded and it is checking the wrong thing.'
    );
  }
  const url = new URL(m[1]);
  const [, owner, repo, ...rest] = url.pathname.split('/');
  if (!owner || !repo || !rest.length) throw new Error(`cannot read owner/repo/path out of the pin: ${m[1]}`);
  return { base: url.origin, owner, repo, path: rest.join('/'), ref: m[2].replace(/['"]/g, '') };
};

// Which declared wordings are NOT in the source. Substring rather than regex:
// the thing being protected is a literal, and a regex here would need escaping
// that could only make it match more loosely than the tally does.
export const missingFrom = (source) => {
  const text = String(source);
  return CONTRACT.filter((c) => !text.includes(c.shell));
};

export const contractLines = (missing, { ref, path }) => {
  if (!missing.length) return [`all ${CONTRACT.length} verdict wording(s) still present in ${path}@${ref}`];
  return [
    `${missing.length} of ${CONTRACT.length} verdict wording(s) are gone from ${path}@${ref}:`,
    ...missing.map((c) => `  ${c.outcome}  ${c.shell}`),
    '',
    'scripts/delete-retries-core.mjs matches those lines. Every run ending on a reworded one now lands in the',
    "daily tally's `unknown` bucket instead of its own, which is a shrinking number rather than an alarm.",
    'Fix by updating VERDICTS there and CONTRACT here together, or by reverting the wording in the action.',
  ];
};
