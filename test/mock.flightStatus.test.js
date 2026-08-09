import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockFlightStatus } from '../src/mock/flightStatus.js';

test('the same flight number yields the same status across repeated calls', () => {
  const a = mockFlightStatus('B6666');
  const b = mockFlightStatus('B6666');

  assert.equal(a.status, b.status);
  assert.equal(a.gate, b.gate);
  assert.equal(a.origin, b.origin);
  assert.equal(a.destination, b.destination);
});

test('is tagged mock and includes the flight number', () => {
  const status = mockFlightStatus('AA100');

  assert.equal(status.mock, true);
  assert.equal(status.flightNumber, 'AA100');
});

test('different flight numbers can yield different statuses', () => {
  const numbers = ['AA1', 'AA2', 'AA3', 'AA4', 'AA5', 'AA6', 'AA7', 'AA8'];
  const statuses = new Set(numbers.map((n) => mockFlightStatus(n).status));

  assert.ok(statuses.size > 1);
});
