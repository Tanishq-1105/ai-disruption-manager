import { config } from '../config.js';
import { getAccessToken } from './auth.js';

async function sabreRequest(path, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const token = await getAccessToken({ fetchImpl });

  const res = await fetchImpl(`${config.sabre.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error(`Sabre request failed: ${method} ${path} -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

// Bargain Finder Max — primary source of replacement flight options, also
// used to seed the simulator's inventory at startup.
// NOTE: confirm the exact BFM path/payload shape for this account's API
// version against the Sabre dev portal before pointing this at real creds.
export function searchFlights(criteria, opts) {
  return sabreRequest('/v2/shop/flights', { method: 'POST', body: criteria, ...opts });
}

export function searchHotels(criteria, opts) {
  return sabreRequest('/v1/shop/hotels', { method: 'POST', body: criteria, ...opts });
}

export function getFlightStatus(criteria, opts) {
  return sabreRequest('/v1/flightstatus', { method: 'POST', body: criteria, ...opts });
}
