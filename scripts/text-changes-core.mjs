// The parts of the text-change gate that read nothing, kept apart so
// test/text-changes.test.mjs covers them without a git history to walk.
//
// docs/text-changes.yaml is the board's record of every place the page text
// differs from the original rovar.no, and the client page reads it from the
// forge. A record kept by hand went 60 content commits stale between
// 2026-08-25 and 2026-10-24, so a change to page text now has to touch the
// list in the same push, or say in a commit message that it changed no words.

export const LIST = 'docs/text-changes.yaml';

// A line of its own in any commit message of the range: a reflow, a heading
// level or a link target changes these files without changing what the board
// reads.
export const OPT_OUT = /^Text-changes: none\b/m;

export const isPageText = (path) =>
  path.startsWith('src/content/pages/') || /^src\/i18n\/ui\/[^/]+\.json$/.test(path);

export function verdict({ files, messages }) {
  const text = files.filter(isPageText);
  if (text.length === 0) return { ok: true, summary: 'no page text changed' };
  if (files.includes(LIST)) return { ok: true, summary: `page text and ${LIST} changed together` };
  if (messages.some((m) => OPT_OUT.test(m))) {
    return { ok: true, summary: `page text changed, and a commit says no words did (${text.length} files)` };
  }
  return { ok: false, summary: `page text changed without ${LIST}`, files: text };
}

// The range a run covers, as `git diff`/`git log` arguments, or null when there
// is nothing to compare. Same fallbacks as ci-actions' attribution gate: the
// push's own range, else the merged-in side, else a root commit with no parent.
export function range({ event, sha, before, baseRef, mergeBase, exists }) {
  if (event === 'pull_request') return { from: mergeBase(`origin/${baseRef}`, sha), to: sha };
  if (event !== 'push') return null;
  if (!exists(sha)) throw new Error(`${sha} is not in the checkout`);
  if (before && !/^0+$/.test(before) && exists(before)) return { from: before, to: sha };
  if (exists(`${sha}^1`)) return { from: `${sha}^1`, to: sha };
  return null;
}

// The renderer (nixfleet scripts/client-pages.py, TEXT_CHANGES) is the authority
// on this shape. It keeps the last good copy when a push breaks it, so this
// copy of the rules only moves that warning from the client page to CI.
const TEXT = (v) => typeof v === 'string' || typeof v === 'number';

function only(where, value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${where}: expected a mapping`);
  }
  for (const k of Object.keys(value)) {
    if (!keys.includes(k)) throw new Error(`${where}: unknown key '${k}'`);
  }
}

function text(where, value, required) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${where}: missing`);
    return;
  }
  if (!TEXT(value)) throw new Error(`${where}: expected text, got ${typeof value}`);
}

function list(where, value, required) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${where}: missing`);
    return [];
  }
  if (!Array.isArray(value)) throw new Error(`${where}: expected a list`);
  return value;
}

function table(where, t) {
  if (t === undefined || t === null) return;
  only(where, t, ['head', 'rows']);
  const head = list(`${where}.head`, t.head, false);
  head.forEach((c, i) => text(`${where}.head[${i}]`, c, true));
  const rows = list(`${where}.rows`, t.rows, true);
  rows.forEach((r, i) => list(`${where}.rows[${i}]`, r, true).forEach((c, j) => text(`${where}.rows[${i}][${j}]`, c, true)));
  if (new Set([...rows, head].filter((r) => r.length).map((r) => r.length)).size > 1) {
    throw new Error(`${where}: every row needs as many cells as the others and the head`);
  }
}

export function checkShape(doc) {
  only('top level', doc, ['note', 'groups']);
  text('note', doc.note, false);
  list('groups', doc.groups, true).forEach((g, i) => {
    const where = `groups[${i}]`;
    only(where, g, ['title', 'text', 'table', 'points']);
    text(`${where}.title`, g.title, true);
    text(`${where}.text`, g.text, false);
    table(`${where}.table`, g.table);
    list(`${where}.points`, g.points, false).forEach((pt, j) => {
      const at = `${where}.points[${j}]`;
      only(at, pt, ['title', 'text', 'table']);
      text(`${at}.title`, pt.title, true);
      text(`${at}.text`, pt.text, false);
      table(`${at}.table`, pt.table);
    });
  });
}
