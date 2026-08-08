import * as sabreClient from '../sabre/client.js';
import * as simulator from '../simulator/state.js';

/**
 * The single provider port the agent core depends on. Search/information
 * calls route to Sabre (real); action/booking calls route to the simulator.
 * Going to production is swapping the simulator import below for a real
 * ticketing adapter that implements the same shape — the agent core never
 * changes.
 */
export const provider = {
  // Information half — Sabre.
  searchFlights: sabreClient.searchFlights,
  searchHotels: sabreClient.searchHotels,
  getFlightStatus: sabreClient.getFlightStatus,

  // Action half — simulator.
  seedInventory: simulator.seedInventory,
  cancelFlight: simulator.cancelFlight,
  delayFlight: simulator.delayFlight,
  setForceNextBookingFailure: simulator.setForceNextBookingFailure,
  bookFlight: simulator.bookFlight,
  cancelBooking: simulator.cancelBooking,
  getState: simulator.getState,
};
