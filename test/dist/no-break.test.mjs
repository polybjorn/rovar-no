/**
 * No line on a built page can start with a dash or split a number from its
 * unit, its thousands or the rest of a phone number (#177).
 *
 * The rehype pass (src/plugins/rehype-nbsp.mjs) reaches markdown only; text
 * from a component or a UI string reaches the page around it, so the built
 * page is what this reads. A UI string carries its no-break space itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glue } from '../../src/plugins/rehype-nbsp.mjs';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');

const pages = readdirSync(DIST, { recursive: true })
  .filter((name) => name.endsWith('.html'))
  .map((name) => join(DIST, name));

test('no line on a built page can start with a dash or split a number', () => {
  assert.ok(pages.length > 10, `only ${pages.length} pages in dist, so the rest proves little`);
  const off = [];
  for (const file of pages) {
    const body = readFileSync(file, 'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? '';
    const text = body.replace(/<(script|style|template)\b[\s\S]*?<\/\1>/g, '').replace(/&nbsp;|&#160;/g, ' ');
    for (const run of text.split(/<[^>]*>/)) {
      if (glue(run) !== run) off.push(`${relative(DIST, file)}: "${run.trim()}"`);
    }
  }
  assert.deepEqual(off, []);
});
