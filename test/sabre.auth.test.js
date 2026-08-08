import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAccessToken, _resetTokenCacheForTests } from '../src/sabre/auth.js';

test('reuses a cached token until it nears expiry', async () => {
  _resetTokenCacheForTests();
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, json: async () => ({ access_token: 'tok-1', expires_in: 3600 }) };
  };
  const now = 0;

  const token1 = await getAccessToken({ fetchImpl, now: () => now });
  const token2 = await getAccessToken({ fetchImpl, now: () => now + 1000 });

  assert.equal(token1, 'tok-1');
  assert.equal(token2, 'tok-1');
  assert.equal(calls, 1, 'second call should reuse the cached token');
});

test('refreshes once the cached token is within the expiry skew', async () => {
  _resetTokenCacheForTests();
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, json: async () => ({ access_token: `tok-${calls}`, expires_in: 3600 }) };
  };

  await getAccessToken({ fetchImpl, now: () => 0 });
  const token = await getAccessToken({ fetchImpl, now: () => 3_600_000 }); // at nominal expiry

  assert.equal(token, 'tok-2');
  assert.equal(calls, 2);
});

test('throws with status and body when Sabre rejects the credentials', async () => {
  _resetTokenCacheForTests();
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'invalid_client' });

  await assert.rejects(
    () => getAccessToken({ fetchImpl, now: () => 0 }),
    /Sabre auth failed: 401 invalid_client/
  );
});
