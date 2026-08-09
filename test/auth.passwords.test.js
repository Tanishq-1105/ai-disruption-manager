import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../src/auth/passwords.js';

test('hashes a password and verifies it round-trips', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
});

test('rejects the wrong password', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('validatePasswordStrength requires at least 8 characters', () => {
  assert.equal(validatePasswordStrength('short7c'), false);
  assert.equal(validatePasswordStrength('exactly8'), true);
  assert.equal(validatePasswordStrength(undefined), false);
});
