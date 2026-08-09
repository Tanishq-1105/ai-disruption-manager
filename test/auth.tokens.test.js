import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../src/auth/tokens.js';

const secret = 'test-secret';

test('signs and verifies a token round-trip', () => {
  const token = signToken({ sub: 'user-1', email: 'a@example.com' }, { secret, expiresIn: '1h' });
  const payload = verifyToken(token, { secret });

  assert.equal(payload.sub, 'user-1');
  assert.equal(payload.email, 'a@example.com');
});

test('rejects a token signed with a different secret', () => {
  const token = signToken({ sub: 'user-1' }, { secret: 'other-secret', expiresIn: '1h' });
  assert.throws(() => verifyToken(token, { secret }));
});

test('rejects an expired token', () => {
  const token = signToken({ sub: 'user-1' }, { secret, expiresIn: -1 });
  assert.throws(() => verifyToken(token, { secret }));
});
