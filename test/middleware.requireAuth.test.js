import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireAuth } from '../src/middleware/requireAuth.js';
import { optionalAuth } from '../src/middleware/optionalAuth.js';
import { signToken } from '../src/auth/tokens.js';

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

test('requireAuth 401s when the header is missing', () => {
  const req = { headers: {} };
  const res = mockRes();
  let nextCalled = false;

  requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('requireAuth 401s on an invalid token', () => {
  const req = { headers: { authorization: 'Bearer not-a-real-token' } };
  const res = mockRes();

  requireAuth(req, res, () => {
    throw new Error('next should not be called');
  });

  assert.equal(res.statusCode, 401);
});

test('requireAuth sets req.user and calls next on a valid token', () => {
  const token = signToken({ sub: 'user-1', email: 'a@example.com' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockRes();
  let nextCalled = false;

  requireAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.user.id, 'user-1');
  assert.equal(req.user.email, 'a@example.com');
});

test('optionalAuth proceeds unauthenticated when no token is present', () => {
  const req = { headers: {} };
  const res = mockRes();
  let nextCalled = false;

  optionalAuth(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(req.user, undefined);
});

test('optionalAuth sets req.user when a valid token is present', () => {
  const token = signToken({ sub: 'user-1', email: 'a@example.com' });
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = mockRes();

  optionalAuth(req, res, () => {});

  assert.equal(req.user.id, 'user-1');
});
