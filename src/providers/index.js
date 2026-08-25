import { config } from '../config.js';
import * as sabreClient from '../sabre/client.js';
import * as duffelAdapter from '../duffel/adapter.js';
import * as simulator from '../simulator/state.js';
import * as mockHotels from '../mock/hotels.js';
import * as mockCabs from '../mock/cabs.js';

/**
 * The single provider port the agent core depends on. Search/information
 * calls route to Sabre (real) where available; action/booking calls route to
 * the simulator. Going to production is swapping the simulator import below
 * for a real ticketing adapter that implements the same shape — the agent
 * core never changes.
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

function bookingAdapter() {
  if (config.providers.booking === 'duffel') {
    return {
      bookFlight: duffelAdapter.bookFlight,
      cancelBooking: releaseBooking,
      getBooking: duffelAdapter.getBooking,
      searchBookableFlights: duffelAdapter.searchFlights,
      getSeatMap: duffelAdapter.getSeatMap,
    };
  }
  return {
    bookFlight: simulator.bookFlight,
    cancelBooking: simulator.cancelBooking,
  };
}

export const provider = {
  // Information half — Sabre where the trial account has the product
  // provisioned, mock fixtures where it doesn't (hotels) or never will
  // (cabs — Sabre has no rideshare product at all).
  searchFlights: sabreClient.searchFlights,
  searchHotels: mockHotels.searchMockHotels,
  searchCabs: mockCabs.searchMockCabs,
  getFlightStatus: sabreClient.getFlightStatus,

  // Action half. Which adapter books is a configuration choice, not a code
  // change — this is the swap the hexagonal architecture exists for. The
  // simulator stays the default because it is the only one that cannot fail a
  // live demo; `BOOKING_PROVIDER=duffel` books real sandbox orders instead.
  ...bookingAdapter(),

  seedTrip: simulator.seedTrip,
  getTrip: simulator.getTrip,
  cancelNode: simulator.cancelNode,
  delayFlight: simulator.delayFlight,
  setForceNextBookingFailure: simulator.setForceNextBookingFailure,
  adjustNode: simulator.adjustNode,
  getState: simulator.getState,
};
