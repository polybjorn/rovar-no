// node --test. Covers groupWhen (src/plugins/rehype-structure.mjs): in a list
// whose rows are all dated, each date is printed once, over the rows it covers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groupWhen } from '../src/plugins/rehype-structure.mjs';

const text = (value) => ({ type: 'text', value });
const el = (tagName, properties, children) => ({ type: 'element', tagName, properties, children });
const row = (label, when, until) => el('li', until ? { dataUntil: until } : {}, [
  el('strong', {}, [text(label)]),
  el('span', { className: ['fact-value'] }, [text('kl. 12')]),
  ...(when ? [el('span', { className: ['fact-when'] }, [text(when)])] : []),
]);
const textOf = (node) => node.type === 'text' ? node.value : (node.children ?? []).map(textOf).join('');
const shape = (ul) => ul.children.map((li) => li.properties.className?.includes('fact-group')
  ? `[${li.children.map(textOf).join('|')}]`
  : li.children.map(textOf).join('|'));
const extraRow = (label, when) => el('li', {}, [
  el('strong', {}, [text(label)]),
  el('span', { className: ['fact-value'] }, [text('kl. 12')]),
  el('span', { className: ['fact-extra'] }, [el('strong', {}, [text('Mat:')]), text('kl. 13')]),
  el('span', { className: ['fact-when'] }, [text(when)]),
]);

test('a date two rows share becomes one heading, and every other date moves up too', () => {
  const ul = el('ul', {}, [row('A', 'til 16. august', '2026-08-16'), row('B', 'til 16. august', '2026-08-16'), row('C', 'høst', '2026-09-30')]);
  groupWhen(ul);
  assert.deepEqual(shape(ul), ['[til 16. august]', 'A|kl. 12', 'B|kl. 12', '[høst]', 'C|kl. 12']);
});

test('the heading carries its rows\' last day, and the rows keep theirs', () => {
  const ul = el('ul', {}, [row('A', 'x', '2026-08-16'), row('B', 'x', '2026-08-16')]);
  groupWhen(ul);
  assert.deepEqual(ul.children.map((li) => li.properties.dataUntil), ['2026-08-16', '2026-08-16', '2026-08-16']);
});

test('rows with dates of their own each get a heading', () => {
  const ul = el('ul', {}, [row('A', 'til 16. august'), row('B', 'høst')]);
  groupWhen(ul);
  assert.deepEqual(shape(ul), ['[til 16. august]', 'A|kl. 12', '[høst]', 'B|kl. 12']);
});

test('a list of one row keeps its date on the row', () => {
  const ul = el('ul', {}, [row('A', 'x')]);
  groupWhen(ul);
  assert.deepEqual(shape(ul), ['A|kl. 12|x']);
});

test('a list with an undated row is left as it is', () => {
  const ul = el('ul', {}, [row('A', 'x'), row('B', 'x'), row('C')]);
  groupWhen(ul);
  assert.deepEqual(shape(ul), ['A|kl. 12|x', 'B|kl. 12|x', 'C|kl. 12']);
});

test('an extra column\'s label moves into the heading over its times, and only there', () => {
  const ul = el('ul', { className: ['fact-list'] }, [extraRow('A', 'x'), extraRow('B', 'x'), row('C', 'y')]);
  groupWhen(ul);
  assert.deepEqual(shape(ul), ['[x|Mat]', 'A|kl. 12|kl. 13', 'B|kl. 12|kl. 13', '[y]', 'C|kl. 12']);
  assert.ok(ul.properties.className.includes('has-extra'));
});

test('a list with no extra column is not marked as having one', () => {
  const ul = el('ul', { className: ['fact-list'] }, [row('A', 'x'), row('B', 'x')]);
  groupWhen(ul);
  assert.deepEqual(ul.properties.className, ['fact-list']);
});
