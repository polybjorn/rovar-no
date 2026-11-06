/**
 * Text colours hold WCAG's 4.5:1 on every surface they sit on (#192).
 *
 * Reads the custom properties straight out of global.css, so a colour edited
 * there is measured as the site ships it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
const root = css.match(/:root\s*{([\s\S]*?)\n}/)[1];
const color = (name) => {
  const hex = root.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  assert.ok(hex, `--color-${name} is not a six-digit hex in :root`);
  return hex;
};

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const surfaces = ['foam', 'sand', 'sand-dark'];
const pairs = [
  ...['ocean-light', 'text', 'text-light', 'text-passed'].flatMap((fg) => surfaces.map((bg) => [fg, bg])),
  // The notice chip on the board: white on the link blue, and on the passed
  // grey once its departure has left.
  ['on-dark', 'ocean-light'],
  ['on-dark', 'text-passed'],
];

for (const [fg, bg] of pairs) {
  test(`--color-${fg} on --color-${bg} is 4.5:1 or more`, () => {
    const r = ratio(color(fg), color(bg));
    assert.ok(r >= 4.5, `${r.toFixed(2)}:1`);
  });
}

test('passed departures are greyed by colour, not by opacity', () => {
  const board = readFileSync(new URL('../src/components/DepartureBoard.astro', import.meta.url), 'utf8');
  const rules = [...board.matchAll(/([^{}]*\.passed[^{}]*){([^}]*)}/g)];
  assert.ok(rules.length > 0, 'no .passed rule found in DepartureBoard.astro');
  for (const [, selector, body] of rules) {
    assert.doesNotMatch(body, /opacity/, `${selector.trim()} fades by opacity`);
  }
});
