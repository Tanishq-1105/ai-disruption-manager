// Watcher core (Phase 2) — PURE. No polling, no DB, no network. Answers only
// "is something wrong?" given a trip snapshot, then hands off to impact.js.

const MIN_CONNECTION_MINUTES = 45;

export function detectDisruptions(trip, { now = Date.now } = {}) {
  const events = [];
  const flights = trip.nodes.filter((n) => n.type === 'FLIGHT');

  for (const flight of flights) {
    if (flight.status === 'CANCELLED') {
      events.push({
        type: 'CANCELLATION',
        tripId: trip.id,
        nodeId: flight.id,
        detectedAt: new Date(now()).toISOString(),
      });
    }
  }

  // Connection-feasibility check: can fire while the traveller is still
  // airborne, since it compares projected (not actual) arrival against the
  // next leg's scheduled departure.
  for (const flight of flights) {
    if (flight.status === 'CANCELLED') continue;

    for (const upstreamId of flight.dependsOn || []) {
      const upstream = flights.find((f) => f.id === upstreamId);
      if (!upstream || upstream.status === 'CANCELLED') continue;

      const arrival = new Date(upstream.projectedArrival || upstream.scheduledArrival);
      const departure = new Date(flight.scheduledDeparture);
      const minutesAvailable = (departure - arrival) / 60_000;

      if (minutesAvailable < MIN_CONNECTION_MINUTES) {
        events.push({
          type: 'CONNECTION_AT_RISK',
          tripId: trip.id,
          nodeId: flight.id,
          upstreamNodeId: upstream.id,
          minutesAvailable,
          detectedAt: new Date(now()).toISOString(),
        });
      }
    }
  }

  return events;
}
