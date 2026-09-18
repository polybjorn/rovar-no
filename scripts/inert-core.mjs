// Decides whether a change is PROVABLY inert: whether merging it can alter what
// this repo does or what the site serves. The network half is in
// check-inert-prs.mjs; everything here is pure so test/inert.test.mjs can cover
// it, same split as merged-prs-core.mjs and delete-retries-core.mjs.
//
// This exists because #50 measured that 4 of the first 24 merges on main were
// comment or README changes that still waited on a person to merge them. The
// point of proving it mechanically rather than reading the title is that a
// title is a claim: `docs(ci): correct the branch-delete encoding comment`
// (760c26c2) changed javascript inside a yaml heredoc, and `docs: correct three
// stale comments` (a05a9328) also changed behaviour.
//
// THE ONLY DIRECTION THIS IS ALLOWED TO BE WRONG IN IS "not provable". Every
// rule below refuses rather than guesses, because the consequence of a false
// "inert" is an unreviewed change on main and, since the site deploys from
// GitHub Pages on every push there, published. A false "not inert" costs one
// human merge, which is the thing we have today.

// Two hazards make the naive version of this unsound, and both are present in
// this repo rather than hypothetical.
//
//   1. A `#` line is not always a yaml comment. deps-update.yml embeds
//      javascript in `node - <<'JS'` heredocs, and `#count = 0` is a legal
//      private class field. A stripper that treats every `#` line as a comment
//      would read a change to one as cosmetic. So nothing inside a block scalar
//      is ever treated as a comment - see stripYaml.
//   2. A `//` line is not always a javascript comment. It can sit inside a
//      template literal, which is the one string that spans lines. So stripJs
//      tracks template literals and refuses when it cannot follow the file.
//
// The cost of rule 1 is real and accepted: the large comment blocks inside this
// repo's `run: |` steps are not provable, only the headers above `jobs:` are.

// A file that appears or disappears is never a comment change, whatever its
// contents. Renames are the same: the diff is not the question, the new path is,
// and a moved file can change what a build picks up.
export const STRUCTURAL = new Set(['added', 'removed', 'renamed', 'copied']);

// Markdown is inert ONLY outside the build. 16 of this repo's 17 tracked .md
// files are src/content/pages/**, which is site copy - a blanket ".md is docs"
// rule would have auto-merged page text. So the allowlist is the repo root and
// docs/, and anything else is content until proven otherwise.
export const isDocs = (path) =>
  /^[^/]+\.md$/.test(path) || /^docs\/[^/]*[^/]\.md$/.test(path);

// YAML, block-scalar aware. Outside a block scalar a full-line `#` is a comment
// and blank lines carry nothing. Inside one, every line is kept verbatim: the
// content belongs to some other language and this function does not know which.
export const stripYaml = (text) => {
  const out = [];
  let blockIndent = null; // indent of the key that opened the block scalar
  for (const line of text.split('\n')) {
    const indent = line.search(/\S/);
    if (blockIndent !== null) {
      // A blank line inside a block scalar is part of it. The block ends at the
      // first non-blank line indented no further than the key that opened it.
      if (indent === -1 || indent > blockIndent) { out.push(line); continue; }
      blockIndent = null;
    }
    if (indent === -1) continue;
    if (line.trimStart().startsWith('#')) continue;
    out.push(line);
    // `run: |`, `run: >-`, `- run: |` etc. A trailing comment after the
    // indicator is allowed by yaml and does not change that this opens a block.
    if (/:\s*[|>][+-]?\d*\s*(#.*)?$/.test(line)) blockIndent = indent;
  }
  return out.join('\n');
};

// Javascript. Returns null when the file cannot be followed, which the caller
// must treat as "not provable" rather than as "no comments found".
//
// Only WHOLE-LINE comments are removed. A trailing `// ...` is left alone
// because deciding where it starts needs to know whether an earlier `/` opened a
// regular expression, and getting that wrong deletes code. Line-leading is
// enough: a regex cannot span a line break, so the only constructs that carry
// state across lines are template literals and block comments.
export const stripJs = (text) => {
  const lines = text.split('\n');
  const keep = [];
  let state = 'code'; // code | tpl | block
  let tplDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const wholeLineComment =
      state === 'code' && (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*'));
    const startedInBlock = state === 'block';
    let hadCode = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i], n = line[i + 1];
      if (state === 'block') {
        if (c === '*' && n === '/') { state = 'code'; i++; }
        continue;
      }
      if (state === 'tpl') {
        if (c === '\\') { i++; hadCode = true; continue; }
        if (c === '`') { state = 'code'; tplDepth--; }
        hadCode = true;
        continue;
      }
      // state === 'code'
      if (c === '/' && n === '/') break;          // rest of the line is a comment
      if (c === '/' && n === '*') { state = 'block'; i++; continue; }
      if (c === '`') { state = 'tpl'; tplDepth++; hadCode = true; continue; }
      if (c === '"' || c === "'") {
        // An ordinary string cannot cross a line break, so it is consumed here
        // or the file is not something this function understands.
        const quote = c;
        let closed = false;
        for (i++; i < line.length; i++) {
          if (line[i] === '\\') { i++; continue; }
          if (line[i] === quote) { closed = true; break; }
        }
        if (!closed) return null; // unterminated, or a quote inside a regex
        hadCode = true;
        continue;
      }
      if (!/\s/.test(c)) hadCode = true;
    }

    if (state === 'tpl' && tplDepth < 1) return null;
    // A line that only closed a block comment it did not open contributes
    // nothing, and a whole-line comment contributes nothing by definition.
    if (wholeLineComment || (startedInBlock && !hadCode)) continue;
    if (hadCode) keep.push(line);
  }

  if (state !== 'code') return null; // ended inside a template literal or block comment
  return keep.join('\n');
};

export const STRIPPERS = new Map([
  ['yml', stripYaml], ['yaml', stripYaml],
  ['mjs', stripJs], ['js', stripJs], ['ts', stripJs], ['mts', stripJs],
]);
// Deliberately absent: .sh, because shell heredocs are a third dialect this
// would have to learn, and check-attribution.sh is the last file in the repo
// that should ever land without being read. .json and .astro have no comment
// syntax to speak of. Anything not listed is not provable, which is the safe
// default rather than an oversight.

// One file's verdict: 'docs', 'comment', 'content' or 'logic'. `before` and
// `after` are the file's full text on each side; `status` comes from the diff.
export const classifyFile = ({ path, status, before, after }) => {
  if (STRUCTURAL.has(status)) return { path, verdict: 'logic', why: `${status} file` };
  if (path.endsWith('.md')) {
    return isDocs(path)
      ? { path, verdict: 'docs', why: 'markdown outside the build' }
      : { path, verdict: 'content', why: 'markdown inside the build' };
  }
  const ext = path.includes('.') ? path.split('.').pop() : '';
  const strip = STRIPPERS.get(ext);
  if (!strip) return { path, verdict: 'logic', why: `no comment prover for .${ext}` };
  if (before == null || after == null) return { path, verdict: 'logic', why: 'a side is missing' };
  const a = strip(before), b = strip(after);
  if (a === null || b === null) return { path, verdict: 'logic', why: 'the prover could not follow this file' };
  return a === b
    ? { path, verdict: 'comment', why: 'identical with comments removed' }
    : { path, verdict: 'logic', why: 'differs with comments removed' };
};

export const INERT = new Set(['docs', 'comment']);

// A change is inert only if every file in it is, and only if there is at least
// one file - an empty list proving "inert" would be a hole rather than a result.
export const classifyChange = (files) => {
  const verdicts = files.map(classifyFile);
  const blockers = verdicts.filter((v) => !INERT.has(v.verdict));
  return { inert: verdicts.length > 0 && blockers.length === 0, verdicts, blockers };
};

export const verdictLines = ({ inert, verdicts }) => {
  // An empty diff says so in words. It is the normal answer for a pull request
  // whose head is already contained in main, and a bare "NOT INERT" with no
  // file lines under it reads like the prover fell over instead.
  if (!verdicts.length) return ['NOT INERT: the diff is empty - nothing here would land'];
  return [
    inert ? 'INERT: nothing here can change behaviour or the built site' : 'NOT INERT: needs a person',
    ...verdicts.map((v) => `  ${v.verdict.padEnd(8)} ${v.path}  (${v.why})`),
  ];
};
