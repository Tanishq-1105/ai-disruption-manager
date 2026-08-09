// Best-effort mapping for a real Sabre flight-status response — UNVERIFIED
// against this trial account, since every candidate endpoint path 404s (see
// src/sabre/client.js's getFlightStatus). Kept so the tracking route never
// has to branch on real-vs-mock shape if/when this account gets the product.
export function normalizeFlightStatus(sabreResponse, flightNumber) {
  const flight =
    sabreResponse?.FlightStatuses?.FlightStatus?.[0] || sabreResponse?.FlightStatus || sabreResponse;
  if (!flight) return null;

  return {
    flightNumber: String(flightNumber),
    airline: flight.MarketingAirline?.Code || flight.Carrier || null,
    status: flight.Status || flight.FlightStatus || 'UNKNOWN',
    origin: flight.DepartureAirport?.LocationCode || flight.Origin || null,
    destination: flight.ArrivalAirport?.LocationCode || flight.Destination || null,
    scheduledDeparture: flight.ScheduledDepartureDateTime || null,
    estimatedDeparture: flight.EstimatedDepartureDateTime || flight.ScheduledDepartureDateTime || null,
    scheduledArrival: flight.ScheduledArrivalDateTime || null,
    estimatedArrival: flight.EstimatedArrivalDateTime || flight.ScheduledArrivalDateTime || null,
    gate: flight.DepartureGate || flight.Gate || null,
    mock: false,
  };
}
