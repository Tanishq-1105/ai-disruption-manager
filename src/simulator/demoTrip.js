export const DEMO_TRIP_ID = 'demo-trip';

// A realistic ripple: outbound leg -> connecting leg -> hotel -> ground
// transport, plus a commitment that depends on the hotel. Cancelling or
// delaying flight-out is enough to cascade through the whole chain.
export function buildDemoTrip() {
  return [
    {
      id: 'flight-out',
      type: 'FLIGHT',
      origin: 'JFK',
      destination: 'ORD',
      scheduledDeparture: '2026-08-09T14:00:00Z',
      scheduledArrival: '2026-08-09T16:00:00Z',
      reversible: true,
      refundable: true,
      dependsOn: [],
    },
    {
      id: 'flight-connect',
      type: 'FLIGHT',
      origin: 'ORD',
      destination: 'SFO',
      scheduledDeparture: '2026-08-09T17:00:00Z',
      scheduledArrival: '2026-08-09T19:30:00Z',
      reversible: true,
      refundable: true,
      dependsOn: ['flight-out'],
    },
    {
      id: 'hotel-sfo',
      type: 'HOTEL',
      name: 'SFO Marriott',
      checkIn: '2026-08-09T21:00:00Z',
      checkOut: '2026-08-11T11:00:00Z',
      reversible: true,
      refundable: true,
      dependsOn: ['flight-connect'],
    },
    {
      id: 'car-sfo',
      type: 'GROUND',
      provider: 'RideShare',
      pickupTime: '2026-08-09T20:00:00Z',
      reversible: true,
      refundable: true,
      dependsOn: ['flight-connect'],
    },
    {
      id: 'meeting-sfo',
      type: 'COMMITMENT',
      label: 'Client meeting',
      time: '2026-08-10T09:00:00Z',
      reversible: false,
      refundable: false,
      dependsOn: ['hotel-sfo'],
    },
  ];
}
