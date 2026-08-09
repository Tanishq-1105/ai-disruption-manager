import { config } from '../config.js';

// A lapsed token is the most common live-demo failure, so every caller goes
// through this cache and nobody talks to Sabre auth directly.
let cachedToken = null; // { accessToken, expiresAt }

const REFRESH_SKEW_MS = 60_000;

export async function getAccessToken({ fetchImpl = fetch, now = Date.now } = {}) {
  if (cachedToken && cachedToken.expiresAt - REFRESH_SKEW_MS > now()) {
    return cachedToken.accessToken;
  }

  const { clientId, clientSecret, baseUrl } = config.sabre;
  // Sabre's token endpoint requires double base64 encoding: encode the id and
  // secret separately, join with ':', then base64 encode that whole string.
  // A single-pass encode (id:secret -> base64) gets a 401 invalid_client.
  const encodedId = Buffer.from(clientId).toString('base64');
  const encodedSecret = Buffer.from(clientSecret).toString('base64');
  const credentials = Buffer.from(`${encodedId}:${encodedSecret}`).toString('base64');

  const res = await fetchImpl(`${baseUrl}/v2/auth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    throw new Error(`Sabre auth failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now() + data.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

export function _resetTokenCacheForTests() {
  cachedToken = null;
}
