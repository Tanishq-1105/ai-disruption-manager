import { config } from '../config.js';
import { getAccessToken } from './auth.js';

async function sabreRequest(path, { method = 'GET', body, query, fetchImpl = fetch, onError } = {}) {
  const token = await getAccessToken({ fetchImpl });

  const url = new URL(`${config.sabre.baseUrl}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
  }

  const res = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // A true gateway 404 (no matching route) comes back with an empty body,
  // unlike Sabre's application-level error responses which are always JSON —
  // res.json() throws on empty input, so read as text first.
  const raw = await res.text();
  const data = raw ? JSON.parse(raw) : null;

  if (!res.ok) {
    const fallback = onError?.(res, data);
    if (fallback !== undefined) return fallback;
    throw new Error(`Sabre request failed: ${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}

// InstaFlights search — this trial account's REST gateway only has
// GET /v1/shop/flights provisioned (the POST /v2/shop/flights "Bargain
// Finder Max Basic" path 404s: "No service exists for" that resource on
// this account). Swap this for real BFM once the account has that product.
//
// Sabre returns HTTP 404 for a genuinely empty result set too (status:
// "Complete", message: "No results were found"), indistinguishable by
// status code alone from a routing error — only the message text tells
// them apart, so that's what onError checks before treating it as empty.
export function searchFlights({ origin, destination, departuredate, ...rest }, opts) {
  return sabreRequest('/v1/shop/flights', {
    method: 'GET',
    query: { origin, destination, departuredate, ...rest },
    onError: (res, data) =>
      res.status === 404 && data?.message === 'No results were found'
        ? { PricedItineraries: [] }
        : undefined,
    ...opts,
  });
}

// NOTE: no hotel-search path 404s were resolved for this account (tried
// /v1/shop/hotels, /v1/shop/hotels/rates, /v1/get/hotelavailability — all
// gateway 404s). Check the Sabre Dev Studio portal for which hotel product,
// if any, is enabled on this account before wiring this up further.
export function searchHotels(criteria, opts) {
  return sabreRequest('/v1/shop/hotels', { method: 'POST', body: criteria, ...opts });
}

// Every candidate path tried (/v1/flightstatus, /v2/flightstatus,
// /v1/flifo/status, /v1/get/flightstatus) 404s with an empty body on this
// trial account — a true gateway 404 (no route), not InstaFlights' "no
// results" 404 which comes with a JSON body. Treat any 404 here as "this
// product isn't provisioned" and let the caller fall back to mock data.
export function getFlightStatus({ flightNumber, carrier, departuredate, ...rest }, opts) {
  return sabreRequest('/v1/flightstatus', {
    method: 'GET',
    query: { flightnumber: flightNumber, carrier, departuredate, ...rest },
    onError: (res) => (res.status === 404 ? null : undefined),
    ...opts,
  });
}
