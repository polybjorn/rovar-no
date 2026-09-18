import test from 'node:test';
import assert from 'node:assert/strict';
import { stripYaml, stripJs, isDocs, classifyFile, classifyChange, verdictLines } from '../scripts/inert-core.mjs';

// ---------------------------------------------------------------- yaml

test('a header comment change leaves the yaml identical', () => {
  const before = '# old wording\nname: x\non:\n  schedule:\n    - cron: "1 2 * * *"\n';
  const after = '# new wording, longer\n# and on two lines\nname: x\non:\n  schedule:\n    - cron: "1 2 * * *"\n';
  assert.equal(stripYaml(before), stripYaml(after));
});

// The whole reason this prover is block-scalar aware. Inside `run: |` the lines
// belong to some other language and this code does not know which, so it must
// refuse rather than assume `#` means comment. Measured consequence: merge
// 2644ce30 on this repo really was comment-only, and is correctly NOT provable,
// because its comments live inside the shell script rather than above `jobs:`.
test('a comment change inside a run block is not provable', () => {
  const mk = (c) => `name: x\njobs:\n  a:\n    steps:\n      - run: |\n          # ${c}\n          echo hi\n`;
  assert.notEqual(stripYaml(mk('old')), stripYaml(mk('new')));
});

// deps-update.yml embeds javascript in `node - <<'JS'` heredocs, and `#count`
// is a legal private class field. A `#` stripper that reached inside a block
// scalar would read a change to one as cosmetic, which is the exact shape of
// unsoundness this file exists to prevent.
test('a hash line inside an embedded heredoc is code, not a comment', () => {
  const mk = (v) => `jobs:\n  a:\n    steps:\n      - run: |\n          node - <<'JS'\n          class C {\n          #count = ${v};\n          }\n          JS\n`;
  assert.notEqual(stripYaml(mk('0')), stripYaml(mk('1')));
});

test('the block scalar ends at the next key at or below the opening indent', () => {
  const before = 'a:\n  run: |\n    echo one\n  after: 1\n# comment\n';
  const after = 'a:\n  run: |\n    echo one\n  after: 1\n';
  assert.equal(stripYaml(before), stripYaml(after), 'a comment after the block closed is still a comment');
});

test('blank lines and indented comments outside a block scalar carry nothing', () => {
  assert.equal(stripYaml('a: 1\n\n  # note\nb: 2\n'), stripYaml('a: 1\nb: 2\n'));
});

// ---------------------------------------------------------------- javascript

test('whole-line js comments are removed, both kinds', () => {
  const before = '// one\nconst a = 1;\n/* block\n   more */\nconst b = 2;\n';
  const after = '// one, reworded\n// and a second line\nconst a = 1;\nconst b = 2;\n';
  assert.equal(stripJs(before), stripJs(after));
});

test('a trailing comment is left alone, so changing one is not provable', () => {
  assert.notEqual(stripJs('const a = 1; // old\n'), stripJs('const a = 1; // new\n'));
});

// A template literal is the one string that spans lines, so it is the one place
// a line can start with // and mean it literally.
test('a comment-looking line inside a template literal is content', () => {
  const mk = (v) => 'const s = `\n// ' + v + '\n`;\n';
  assert.notEqual(stripJs(mk('one')), stripJs(mk('two')));
});

test('the prover refuses a file it cannot follow', () => {
  assert.equal(stripJs('const s = `unterminated\n'), null, 'unclosed template literal');
  assert.equal(stripJs("const s = 'unterminated\n"), null, 'unclosed ordinary string');
  assert.equal(stripJs('/* unterminated\n'), null, 'unclosed block comment');
});

test('a quote inside a regex makes the prover refuse rather than guess', () => {
  // Deliberate: /it's/ leaves an unbalanced quote for a scanner this simple, and
  // refusing costs one human merge where guessing could delete code.
  assert.equal(stripJs("const re = /it's/;\n"), null);
});

// ---------------------------------------------------------------- paths

test('markdown inside the build is content, not docs', () => {
  assert.equal(isDocs('README.md'), true);
  assert.equal(isDocs('docs/runbook.md'), true);
  // 16 of this repo's 17 tracked .md files are these. A blanket rule would have
  // auto-merged page copy.
  assert.equal(isDocs('src/content/pages/no/home.md'), false);
  assert.equal(isDocs('public/x.md'), false);
});

// ---------------------------------------------------------------- files

test('a file that appears or disappears is never a comment change', () => {
  for (const status of ['added', 'removed', 'renamed', 'copied']) {
    assert.equal(classifyFile({ path: 'a.yml', status, before: '#x\n', after: '#y\n' }).verdict, 'logic');
  }
});

test('an extension with no prover is logic, not a free pass', () => {
  assert.equal(classifyFile({ path: 'check-attribution.sh', status: 'modified', before: '# a\n', after: '# b\n' }).verdict, 'logic');
  assert.equal(classifyFile({ path: 'package.json', status: 'modified', before: '{}', after: '{}' }).verdict, 'logic');
  assert.equal(classifyFile({ path: 'src/pages/index.astro', status: 'modified', before: 'a', after: 'a' }).verdict, 'logic');
});

test('a yaml comment change is a comment, a yaml logic change is not', () => {
  assert.equal(classifyFile({ path: 'w.yml', status: 'modified', before: '# a\nx: 1\n', after: '# b\nx: 1\n' }).verdict, 'comment');
  assert.equal(classifyFile({ path: 'w.yml', status: 'modified', before: '# a\nx: 1\n', after: '# a\nx: 2\n' }).verdict, 'logic');
});

// ---------------------------------------------------------------- changes

test('a change is inert only when every file in it is', () => {
  const comment = { path: 'w.yml', status: 'modified', before: '# a\nx: 1\n', after: '# b\nx: 1\n' };
  const logic = { path: 'w.yml', status: 'modified', before: 'x: 1\n', after: 'x: 2\n' };
  assert.equal(classifyChange([comment]).inert, true);
  assert.equal(classifyChange([comment, { ...logic, path: 'v.yml' }]).inert, false);
  assert.equal(classifyChange([comment, { ...logic, path: 'v.yml' }]).blockers.length, 1);
});

test('an empty change is not inert', () => {
  // Proving "nothing can break" about nothing would be a hole, not a result:
  // a pull request whose diff came back empty is a bug in the caller.
  assert.equal(classifyChange([]).inert, false);
});

test('an empty diff explains itself rather than reading as a failure', () => {
  const lines = verdictLines(classifyChange([]));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /diff is empty/);
});
