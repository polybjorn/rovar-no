/**
 * No built page carries markup the CSP in Layout.astro refuses.
 *
 * `script-src 'self'` refuses an inline script unless it is hashed, and an
 * `on*=` attribute outright; `style-src 'self'` refuses a `style=""` attribute.
 * All three pass `npm run build` and a dev server quietly: Astro inlines a
 * bundled script while it is small, and `define:vars` renders inline scripts
 * and style attributes both. So this reads every page in dist and fails on
 * any of them, naming the page (#165).
 *
 * Data blocks are not executed and stay allowed: JSON-LD and JSON.
 *
 * Ported from polybjorn's test, with regexes in place of jsdom so the repo
 * takes no dependency for it. Tags are matched outside `<script>` bodies, so
 * a `style=` inside script text is not counted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const DATA_TYPES = new Set(['application/ld+json', 'application/json']);

const pages = readdirSync(DIST, { recursive: true })
  .filter((name) => name.endsWith('.html'))
  .map((name) => join(DIST, name));

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const TAG = /<[a-zA-Z][^\s/>]*((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g;
const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g;

const attrValue = (attrs, name) => {
  const m = attrs.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
};

const attrNames = (html) =>
  [...html.replace(SCRIPT, '<script$1></script>').matchAll(TAG)].flatMap((tag) =>
    [...tag[1].matchAll(ATTR)].map((a) => ({ tag: tag[0].match(/^<([^\s/>]+)/)[1].toLowerCase(), name: a[1].toLowerCase() })));

test('there are built pages to check', () => {
  assert.ok(pages.length > 10, `only ${pages.length} pages in dist, so the rest proves little`);
});

for (const file of pages) {
  const page = relative(DIST, file);
  const html = readFileSync(file, 'utf8');

  test(`${page}: no executable inline script`, () => {
    const inline = [...html.matchAll(SCRIPT)]
      .filter(([, attrs]) => attrValue(attrs, 'src') === null)
      .filter(([, attrs]) => !DATA_TYPES.has((attrValue(attrs, 'type') ?? '').trim().toLowerCase()))
      .map(([, , body]) => body.trim().slice(0, 60));
    assert.deepEqual(inline, []);
  });

  test(`${page}: no inline event handler`, () => {
    const handlers = attrNames(html).filter((a) => /^on/.test(a.name)).map((a) => `<${a.tag} ${a.name}>`);
    assert.deepEqual(handlers, []);
  });

  test(`${page}: no style attribute`, () => {
    const styled = attrNames(html).filter((a) => a.name === 'style').map((a) => `<${a.tag} style>`);
    assert.deepEqual(styled, []);
  });
}
