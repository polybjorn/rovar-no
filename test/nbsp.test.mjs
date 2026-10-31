import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glue } from '../src/plugins/rehype-nbsp.mjs';

test('the no-break rules glue a dash, a price, a phone number, a duration and a time', () => {
  assert.equal(glue('Røvær – the island'), 'Røvær – the island');
  assert.equal(glue('1 000 fiskere'), '1 000 fiskere');
  assert.equal(glue('150 kr'), '150 kr');
  assert.equal(glue('51 72 12 00'), '51 72 12 00');
  assert.equal(glue('ca. 45 min'), 'ca. 45 min');
  assert.equal(glue('45 Minuten, 16 år'), '45 Minuten, 16 år');
  assert.equal(glue('kl. 10:00'), 'kl. 10:00');
  for (const text of ['1988 ble', '130 innbyggere', '4 årstider', '6 and 8', 'opp - ned']) assert.equal(glue(text), text);
});
