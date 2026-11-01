// The shape of docs/text-changes.yaml, kept apart so test/text-changes.test.mjs
// covers it. The gate that a page-text change touches the list is
// bjorn/ci-actions text-changes, run as its own CI job; this half needs a YAML
// parser, so it stays in npm test.

// The client-page renderer (client-pages.py, TEXT_CHANGES) is the authority
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
