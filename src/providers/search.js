// One search entry point for the whole app, whichever provider answers.
//
// Both providers end up producing the SAME normalized shape and both go through
// the same plausibility filter, so callers — the mobile search route, the
// recovery loop, the Option Engine — cannot tell them apart and never need to.
//
// Duffel is the default because Sabre's CERT cache only has data for one route
// (JFK-LAX); Duffel returned offers on all ten routes tested, including Indian
// domestic, which Sabre has none of. Sabre stays one env var away.

import { config } from '../config.js';
import * as sabreClient from '../sabre/client.js';
import * as duffelAdapter from '../duffel/adapter.js';
import { normalizeFlightSearchResults } from '../normalize/flights.js';
import { partitionByPlausibility } from '../normalize/plausibility.js';

export function activeSearchProvider() {
  return config.providers.search === 'sabre' ? 'sabre' : 'duffel';
}

/**
 * Searches flights and returns options that are normalized, plausibility
 * filtered, and — when the provider supports booking — carry what is needed to
 * actually book them.
 *
 * Returns the rejects too, so a caller can report what it dropped instead of
 * silently thinning the list.
 */
export async function searchFlights({ origin, destination, departuredate, cabinClass = 'economy' }) {
  const source = activeSearchProvider();

  const options = source === 'sabre'
    ? normalizeFlightSearchResults(
      await sabreClient.searchFlights({ origin, destination, departuredate }),
    )
    : await duffelAdapter.searchFlights({ origin, destination, departuredate, cabinClass });

  // Sabre's cache serves physically impossible itineraries; Duffel has not been
  // seen to, but the filter is cheap and a provider-agnostic guarantee is worth
  // more than a provider-specific assumption.
  const { kept, rejected } = partitionByPlausibility(options);

  return {
    source,
    results: source === 'sabre'
      // Sabre options have no cabin of their own; the search asked for one.
      ? kept.map((f) => ({ ...f, cabin: cabinClass.toUpperCase() }))
      : kept,
    rejected,
  };
}

/**
 * Booking needs a provider-native identifier, so a Duffel booking cannot be
 * made from a Sabre search result. Callers use this to fail loudly at startup
 * rather than confusingly at the moment of booking.
 */
export function providerMismatch() {
  const search = activeSearchProvider();
  const booking = config.providers.booking;
  if (booking === 'duffel' && search !== 'duffel') {
    return `BOOKING_PROVIDER=duffel needs SEARCH_PROVIDER=duffel — a Duffel order `
      + `requires a Duffel offer id, which a ${search} search does not produce.`;
  }
  return null;
}
