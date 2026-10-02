import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../mobile/src/utils/flightSearch.js', import.meta.url), 'utf8');
const { flightSearchError, withDefaultFlightDate } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('flight search validation identifies each missing required field', () => {
  assert.match(flightSearchError({}), /From airport/);
  assert.match(flightSearchError({ origin: 'HYD' }), /To airport/);
  assert.match(flightSearchError({ origin: 'HYD', destination: 'BOM' }), /departure date/);
});

test('flight search validation rejects malformed airports and dates', () => {
  assert.match(flightSearchError({ origin: 'Hyderabad', destination: 'BOM', departuredate: '2030-01-01' }), /From airport/);
  assert.match(flightSearchError({ origin: 'HYD', destination: 'BOM', departuredate: '2030-02-30' }), /valid departure date/);
});

test('flight search validation accepts a complete route with a valid date', () => {
  assert.equal(flightSearchError({ origin: 'HYD', destination: 'BOM', departuredate: '2030-01-01' }), null);
});

test('an omitted date defaults to tomorrow, including month rollover', () => {
  const params = withDefaultFlightDate({ origin: 'HYD', destination: 'BOM' }, new Date(2030, 0, 31, 18));
  assert.equal(params.departuredate, '2030-02-01');
  assert.equal(flightSearchError(params), null);
});

test('a selected date is preserved', () => {
  const params = withDefaultFlightDate({ departuredate: '2030-02-05' }, new Date(2030, 0, 31));
  assert.equal(params.departuredate, '2030-02-05');
});