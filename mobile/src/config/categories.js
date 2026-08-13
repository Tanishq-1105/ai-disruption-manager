import * as endpoints from '../api/endpoints.js';
import { FlightItem } from '../components/FlightItem.js';
import { HotelItem } from '../components/HotelItem.js';
import { CabItem } from '../components/CabItem.js';
import { todayISO } from '../utils/date.js';

// Fewer stops and a shorter routing leave less to re-coordinate if this
// flight gets disrupted, so they proxy for how easily the agent could find
// and book a clean replacement. A heuristic, not the real policy engine —
// deterministic and explainable like everything the agent will eventually score with.
function repairOddsScore(item) {
  return 100 - item.stops * 35 - Math.min(item.durationMinutes / 10, 40);
}

function timeBandOf(iso) {
  if (!iso) return 'unknown';
  const hour = new Date(iso).getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

// One config object per category drives SearchScreen (which fields to show),
// ResultsScreen (how to fetch/sort/filter/render) — avoids three
// near-duplicate screens for what's mechanically the same flow.
export const CATEGORIES = {
  flights: {
    label: 'Flights',
    searchFields: [
      { key: 'origin', label: 'From (e.g. JFK)', autoCapitalize: 'characters' },
      { key: 'destination', label: 'To (e.g. LAX)', autoCapitalize: 'characters' },
      { key: 'departuredate', label: 'Departure date', type: 'date', minDate: () => todayISO() },
    ],
    fetch: endpoints.searchFlights,
    ItemComponent: FlightItem,
    searchableText: (item) => `${item.airline} ${item.flightNumber} ${item.origin} ${item.destination}`,
    sorts: {
      price: { label: 'Price', compare: (a, b) => (a.price.amount ?? Infinity) - (b.price.amount ?? Infinity) },
      duration: { label: 'Duration', compare: (a, b) => a.durationMinutes - b.durationMinutes },
      departure: { label: 'Departure', compare: (a, b) => new Date(a.departureTime) - new Date(b.departureTime) },
      repairOdds: { label: 'Repair odds', compare: (a, b) => repairOddsScore(b) - repairOddsScore(a) },
    },
    filters: [
      {
        key: 'stops',
        label: 'Stops',
        type: 'choice',
        default: 'any',
        options: [
          { value: 'any', label: 'Any' },
          { value: '0', label: 'Nonstop' },
          { value: '1+', label: '1+ stop' },
        ],
        test: (item, value) => value === 'any' || (value === '0' ? item.stops === 0 : item.stops >= 1),
      },
      {
        key: 'timeBand',
        label: 'Departure time',
        type: 'choice',
        default: 'any',
        options: [
          { value: 'any', label: 'Any' },
          { value: 'morning', label: 'Morning' },
          { value: 'afternoon', label: 'Afternoon' },
          { value: 'evening', label: 'Evening' },
          { value: 'night', label: 'Night' },
        ],
        test: (item, value) => value === 'any' || timeBandOf(item.departureTime) === value,
      },
      {
        key: 'airlines',
        label: 'Airlines',
        type: 'multi',
        default: [],
        getOptions: (results) =>
          [...new Set(results.map((item) => item.airline))].sort().map((airline) => ({ value: airline, label: airline })),
        test: (item, values) => values.length === 0 || values.includes(item.airline),
      },
    ],
  },
  hotels: {
    label: 'Hotels',
    searchFields: [
      { key: 'destination', label: 'City (e.g. SFO)', autoCapitalize: 'characters' },
      { key: 'checkIn', label: 'Check-in', type: 'date', minDate: () => todayISO() },
      { key: 'checkOut', label: 'Check-out', type: 'date', minDate: (values) => values.checkIn || todayISO() },
    ],
    fetch: endpoints.searchHotels,
    ItemComponent: HotelItem,
    searchableText: (item) => `${item.name}`,
    sorts: {
      price: { label: 'Price', compare: (a, b) => a.pricePerNight.amount - b.pricePerNight.amount },
      rating: { label: 'Rating', compare: (a, b) => b.rating - a.rating },
    },
    filters: [
      {
        key: 'rating',
        label: 'Minimum rating',
        type: 'choice',
        default: '0',
        options: [
          { value: '0', label: 'Any' },
          { value: '3.5', label: '3.5+' },
          { value: '4', label: '4+' },
          { value: '4.5', label: '4.5+' },
        ],
        test: (item, value) => item.rating >= Number(value),
      },
    ],
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
    filters: [
      {
        key: 'capacity',
        label: 'Seats',
        type: 'choice',
        default: '0',
        options: [
          { value: '0', label: 'Any' },
          { value: '4', label: '4+' },
          { value: '6', label: '6+' },
        ],
        test: (item, value) => item.capacity >= Number(value),
      },
    ],
  },
};
