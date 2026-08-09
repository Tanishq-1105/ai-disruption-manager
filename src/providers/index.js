import * as sabreClient from '../sabre/client.js';
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
export const provider = {
  // Information half — Sabre where the trial account has the product
  // provisioned, mock fixtures where it doesn't (hotels) or never will
  // (cabs — Sabre has no rideshare product at all).
  searchFlights: sabreClient.searchFlights,
  searchHotels: mockHotels.searchMockHotels,
  searchCabs: mockCabs.searchMockCabs,
  getFlightStatus: sabreClient.getFlightStatus,

  // Action half — simulator.
  seedTrip: simulator.seedTrip,
  getTrip: simulator.getTrip,
  cancelNode: simulator.cancelNode,
  delayFlight: simulator.delayFlight,
  setForceNextBookingFailure: simulator.setForceNextBookingFailure,
  bookFlight: simulator.bookFlight,
  cancelBooking: simulator.cancelBooking,
  getState: simulator.getState,
};
