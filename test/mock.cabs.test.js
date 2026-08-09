import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchMockCabs } from '../src/mock/cabs.js';

test('every cab has the required fields, is tagged mock, and has a valid price', () => {
  const cabs = searchMockCabs({ destination: 'SFO' });

  assert.ok(cabs.length > 0);
  for (const cab of cabs) {
    assert.equal(cab.mock, true);
    assert.ok(cab.id);
    assert.ok(cab.provider);
    assert.equal(typeof cab.price.amount, 'number');
    assert.ok(!Number.isNaN(cab.price.amount));
    assert.ok(cab.etaMinutes > 0);
    assert.ok(cab.capacity > 0);
  }
});
