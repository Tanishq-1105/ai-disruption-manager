import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as history from '../src/store/history.js';
import { closeMongo } from '../src/store/mongo.js';

test.beforeEach(async () => {
  await history._resetForTests();
});

after(async () => {
  await closeMongo();
});

test('addEntry then listByUser returns newest first', async () => {
  await history.addEntry({ userId: 'u1', category: 'flights', query: { origin: 'JFK' }, resultCount: 3 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await history.addEntry({ userId: 'u1', category: 'hotels', query: { destination: 'SFO' }, resultCount: 2 });

  const entries = await history.listByUser('u1');

  assert.equal(entries.length, 2);
  assert.equal(entries[0].category, 'hotels');
  assert.equal(entries[1].category, 'flights');
});

test('history is isolated per user', async () => {
  await history.addEntry({ userId: 'u1', category: 'flights', query: {}, resultCount: 1 });
  await history.addEntry({ userId: 'u2', category: 'flights', query: {}, resultCount: 1 });

  const entries = await history.listByUser('u1');

  assert.equal(entries.length, 1);
});
