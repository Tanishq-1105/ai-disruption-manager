import * as endpoints from '../api/endpoints.js';
import { FlightItem } from '../components/FlightItem.js';
import { HotelItem } from '../components/HotelItem.js';
import { CabItem } from '../components/CabItem.js';

// One config object per category drives both SearchScreen (which fields to
// show) and ResultsScreen (how to fetch/sort/render) — avoids three
// near-duplicate screens for what's mechanically the same flow.
export const CATEGORIES = {
  flights: {
    label: 'Flights',
    searchFields: [
      { key: 'origin', label: 'From (e.g. JFK)', autoCapitalize: 'characters' },
      { key: 'destination', label: 'To (e.g. LAX)', autoCapitalize: 'characters' },
      { key: 'departuredate', label: 'Date (YYYY-MM-DD)' },
    ],
    fetch: endpoints.searchFlights,
    ItemComponent: FlightItem,
    searchableText: (item) => `${item.airline} ${item.flightNumber} ${item.origin} ${item.destination}`,
    sorts: {
      price: { label: 'Price', compare: (a, b) => (a.price.amount ?? Infinity) - (b.price.amount ?? Infinity) },
      duration: { label: 'Duration', compare: (a, b) => a.durationMinutes - b.durationMinutes },
      stops: { label: 'Stops', compare: (a, b) => a.stops - b.stops },
    },
  },
  hotels: {
    label: 'Hotels',
    searchFields: [
      { key: 'destination', label: 'City (e.g. SFO)', autoCapitalize: 'characters' },
      { key: 'checkIn', label: 'Check-in (YYYY-MM-DD)' },
      { key: 'checkOut', label: 'Check-out (YYYY-MM-DD)' },
    ],
    fetch: endpoints.searchHotels,
    ItemComponent: HotelItem,
    searchableText: (item) => `${item.name}`,
    sorts: {
      price: { label: 'Price', compare: (a, b) => a.pricePerNight.amount - b.pricePerNight.amount },
      rating: { label: 'Rating', compare: (a, b) => b.rating - a.rating },
    },
  },
  cabs: {
    label: 'Cabs',
    searchFields: [{ key: 'destination', label: 'Pickup area (e.g. SFO)', autoCapitalize: 'characters' }],
    fetch: endpoints.searchCabs,
    ItemComponent: CabItem,
    searchableText: (item) => `${item.provider}`,
    sorts: {
      price: { label: 'Price', compare: (a, b) => a.price.amount - b.price.amount },
      eta: { label: 'ETA', compare: (a, b) => a.etaMinutes - b.etaMinutes },
    },
  },
};
