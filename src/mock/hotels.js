// Sabre's hotel product is not provisioned on this trial account (every
// endpoint path tried 404s — see src/sabre/client.js). This fills that gap
// with fixture data so the browse/filter/sort UI still has something to show.

const FIXTURES = [
  { suffix: 'Grand Hotel', priceOffset: 0, rating: 4.0, amenities: ['wifi', 'breakfast'] },
  { suffix: 'Riverside Inn', priceOffset: 35, rating: 3.5, amenities: ['wifi', 'pool'] },
  { suffix: 'Downtown Suites', priceOffset: 70, rating: 4.5, amenities: ['wifi', 'gym', 'breakfast'] },
  { suffix: 'Airport Plaza', priceOffset: -20, rating: 3.0, amenities: ['wifi', 'parking'] },
  { suffix: 'Boutique Central', priceOffset: 110, rating: 4.8, amenities: ['wifi', 'pool', 'spa'] },
];

export function searchMockHotels({ destination = 'City', checkIn = null, checkOut = null } = {}) {
  const slug = destination.toLowerCase();

  return FIXTURES.map((fixture, i) => ({
    id: `hotel-${slug}-${i}`,
    name: `${destination} ${fixture.suffix}`,
    city: destination,
    checkIn,
    checkOut,
    pricePerNight: { amount: 130 + fixture.priceOffset, currency: 'USD' },
    rating: fixture.rating,
    amenities: fixture.amenities,
    thumbnailUrl: `https://picsum.photos/seed/hotel-${slug}-${i}/400/240`,
    mock: true,
  }));
}
