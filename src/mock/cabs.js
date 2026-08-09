// Sabre has no rideshare/cab product at all — this is always mock data,
// unlike hotels which are mocked only because this trial account lacks access.

const FIXTURES = [
  { provider: 'RideX Economy', capacity: 4, baseFare: 12, etaMinutes: 4 },
  { provider: 'RideX Comfort', capacity: 4, baseFare: 18, etaMinutes: 7 },
  { provider: 'RideX XL', capacity: 6, baseFare: 26, etaMinutes: 9 },
  { provider: 'RideX Black', capacity: 4, baseFare: 42, etaMinutes: 6 },
];

export function searchMockCabs({ destination = 'City' } = {}) {
  const slug = destination.toLowerCase();

  return FIXTURES.map((fixture, i) => ({
    id: `cab-${slug}-${i}`,
    provider: fixture.provider,
    etaMinutes: fixture.etaMinutes,
    price: { amount: fixture.baseFare, currency: 'USD' },
    capacity: fixture.capacity,
    mock: true,
  }));
}
