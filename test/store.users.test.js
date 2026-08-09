import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as users from '../src/store/users.js';
import { closeMongo } from '../src/store/mongo.js';

test.beforeEach(async () => {
  await users._resetForTests();
});

after(async () => {
  await closeMongo();
});

test('createUser assigns an id and normalizes email casing', async () => {
  const user = await users.createUser({ email: 'Person@Example.com', passwordHash: 'hash' });

  assert.ok(user.id);
  assert.equal(user.email, 'person@example.com');
});

test('findByEmail is case-insensitive', async () => {
  await users.createUser({ email: 'person@example.com', passwordHash: 'hash' });

  const found = await users.findByEmail('PERSON@EXAMPLE.COM');

  assert.ok(found);
  assert.equal(found.email, 'person@example.com');
});

test('findById returns the created user', async () => {
  const created = await users.createUser({ email: 'a@example.com', passwordHash: 'hash' });

  const found = await users.findById(created.id);

  assert.equal(found.id, created.id);
});

test('data persists across separate calls against the same store', async () => {
  await users.createUser({ email: 'durable@example.com', passwordHash: 'hash' });

  const found = await users.findByEmail('durable@example.com');

  assert.ok(found);
});

test('findByEmail returns null for an unknown address', async () => {
  const found = await users.findByEmail('nobody@example.com');
  assert.equal(found, null);
});
