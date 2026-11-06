/**
 * The departure lists ship holding their place, so the board does not grow
 * under the reader when the script fills it in (#192). Empty lists made the
 * ferry page the one over Google's 0.1 layout-shift line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPICAL_ROWS } from '../../src/scripts/departures-core.js';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const boards = readdirSync(DIST, { recursive: true })
  .filter((name) => name.endsWith('.html'))
  .map((name) => [name, readFileSync(join(DIST, name), 'utf8')])
  .filter(([, html]) => html.includes('id="from-rovar"'));

test('every ferry page ships both lists with a full skeleton', () => {
  assert.ok(boards.length >= 3, `only ${boards.length} ferry pages in dist`);
  for (const [name, html] of boards) {
    for (const id of ['from-rovar', 'from-haugesund']) {
      const list = html.match(new RegExp(`<div id="${id}"[^>]*>\\s*<ul class="dep-skeleton"[^>]*>([\\s\\S]*?)</ul>`))?.[1];
      assert.ok(list, `${name}: #${id} ships without a skeleton`);
      assert.equal(list.match(/<li\b/g).length, TYPICAL_ROWS, `${name}: #${id} rows`);
    }
  }
});
