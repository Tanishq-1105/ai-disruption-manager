import { config } from '../config.js';
import * as sabreClient from '../sabre/client.js';
import * as duffelAdapter from '../duffel/adapter.js';
import * as memberDuffel from '../duffel/member.js';
import * as simulator from '../simulator/state.js';
import * as mockHotels from '../mock/hotels.js';
import * as mockCabs from '../mock/cabs.js';

/**
 * The single provider port the agent core depends on. Search/information
 * calls route through the search provider layer; booking calls use Duffel's
 * sandbox or the simulator. The agent core never imports either implementation.
 */
// A trip's existing ticket may have been created by a different provider than
// the one booking today — the demo fixture's tickets are simulator bookings,
// while BOOKING_PROVIDER=duffel books real orders. Releasing the old ticket has
// to go to whoever actually holds it, or the executor reports
// "member holds two bookings" for a ticket it could have released cleanly.
//
// Duffel order ids are prefixed `ord_`; anything else belongs to the simulator.
function releaseBooking(bookingId) {
  if (typeof bookingId === 'string' && bookingId.startsWith('ord_')) {
    return duffelAdapter.cancelBooking(bookingId);
  }
  return simulator.cancelBooking(bookingId);
}

function bookingAdapter(bookingProvider) {
  if (bookingProvider === 'duffel') {
    return {
      prepareFlight: duffelAdapter.prepareFlight,
      bookFlight: (request) => duffelAdapter.bookFlight(request, {
        beforeBooking: simulator.failBookingIfArmed,
      }),
      cancelBooking: releaseBooking,
      getBooking: duffelAdapter.getBooking,
      findRecoveryBooking: duffelAdapter.findRecoveryBooking,
      searchBookableFlights: duffelAdapter.searchFlights,
      getSeatMap: duffelAdapter.getSeatMap,
      getFlightQuote: memberDuffel.getFlightQuote,
      createMemberOrder: memberDuffel.createMemberOrder,
      findMemberOrder: memberDuffel.findMemberOrder,
      trackMemberOrder: memberDuffel.trackMemberOrder,
    };
  }
  return {
    prepareFlight: ({ option }) => ({ option: structuredClone(option) }),
    bookFlight: simulator.bookFlight,
    getBooking: simulator.getBooking,
    cancelBooking: simulator.cancelBooking,
  };
}

export function createProvider({ bookingProvider = config.providers.booking } = {}) {
  return {
    // Unified flight search is in providers/search.js. These legacy information
    // methods remain available to existing callers; hotels and cabs are mocks.
    searchFlights: sabreClient.searchFlights,
    searchHotels: mockHotels.searchMockHotels,
    searchCabs: mockCabs.searchMockCabs,
    getFlightStatus: sabreClient.getFlightStatus,

    // Select the booking adapter once per provider, including in offline tests.
    ...bookingAdapter(bookingProvider),

    seedTrip: simulator.seedTrip,
    getTrip: simulator.getTrip,
    cancelNode: simulator.cancelNode,
    delayFlight: simulator.delayFlight,
    setForceNextBookingFailure: simulator.setForceNextBookingFailure,
    replaceFlight: simulator.replaceFlight,
    adjustNode: simulator.adjustNode,
    getState: simulator.getState,
  };
}

export const provider = createProvider();
