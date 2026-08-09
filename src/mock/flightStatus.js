// Sabre's flight-status product isn't provisioned on this trial account
// (every candidate path tried gateway-404s — see src/sabre/client.js). This
// fills the gap with a status that's deterministic per flight number (not
// Math.random()) so repeated lookups in a demo don't flicker between calls.

const STATUSES = ['ON_TIME', 'DELAYED', 'BOARDING', 'DEPARTED', 'LANDED'];
const GATES = ['A12', 'B4', 'C22', 'D7', 'T5-22'];
const ROUTES = [
  ['JFK', 'LAX'],
  ['ORD', 'SFO'],
  ['ATL', 'SEA'],
  ['DFW', 'BOS'],
  ['MIA', 'DEN'],
];

function seedFrom(flightNumber) {
  let hash = 0;
  for (const char of String(flightNumber)) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function mockFlightStatus(flightNumber) {
  const seed = seedFrom(flightNumber);
  const status = STATUSES[seed % STATUSES.length];
  const gate = GATES[seed % GATES.length];
  const [origin, destination] = ROUTES[seed % ROUTES.length];
  const delayMinutes = status === 'DELAYED' ? 15 + (seed % 6) * 10 : 0;

  const now = new Date();
  const scheduledDeparture = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
  const scheduledArrival = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString();
  const estimatedDeparture = new Date(
    new Date(scheduledDeparture).getTime() + delayMinutes * 60_000
  ).toISOString();
  const estimatedArrival = new Date(
    new Date(scheduledArrival).getTime() + delayMinutes * 60_000
  ).toISOString();

  return {
    flightNumber: String(flightNumber),
    airline: String(flightNumber).slice(0, 2),
    status,
    origin,
    destination,
    scheduledDeparture,
    estimatedDeparture,
    scheduledArrival,
    estimatedArrival,
    gate,
    mock: true,
  };
}
