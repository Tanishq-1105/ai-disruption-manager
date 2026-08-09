import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFlightSearchResults } from '../src/normalize/flights.js';

// Real shape confirmed live against JFK->LAX on the project's Sabre trial account.
const SAMPLE_ITINERARY = {
  AirItinerary: {
    OriginDestinationOptions: {
      OriginDestinationOption: [
        {
          FlightSegment: [
            {
              DepartureAirport: { LocationCode: 'JFK' },
              ArrivalAirport: { LocationCode: 'LAX' },
              MarketingAirline: { Code: 'B6' },
              DepartureDateTime: '2026-09-01T11:00:00',
              ArrivalDateTime: '2026-09-01T17:00:00',
              FlightNumber: 666,
              ElapsedTime: 540,
            },
          ],
          ElapsedTime: 540,
        },
      ],
    },
    DirectionInd: 'OneWay',
  },
  AirItineraryPricingInfo: {
    PTC_FareBreakdowns: {
      PTC_FareBreakdown: {
        PassengerFare: { TotalFare: { CurrencyCode: 'USD', Amount: 172.71 } },
      },
    },
  },
};

const CONNECTING_ITINERARY = {
  AirItinerary: {
    OriginDestinationOptions: {
      OriginDestinationOption: [
        {
          FlightSegment: [
            {
              DepartureAirport: { LocationCode: 'JFK' },
              ArrivalAirport: { LocationCode: 'ORD' },
              MarketingAirline: { Code: 'AA' },
              DepartureDateTime: '2026-09-01T08:00:00',
              ArrivalDateTime: '2026-09-01T10:00:00',
              FlightNumber: 100,
              ElapsedTime: 120,
            },
            {
              DepartureAirport: { LocationCode: 'ORD' },
              ArrivalAirport: { LocationCode: 'LAX' },
              MarketingAirline: { Code: 'AA' },
              DepartureDateTime: '2026-09-01T11:00:00',
              ArrivalDateTime: '2026-09-01T13:30:00',
              FlightNumber: 200,
              ElapsedTime: 270,
            },
          ],
          ElapsedTime: 390,
        },
      ],
    },
    DirectionInd: 'OneWay',
  },
  AirItineraryPricingInfo: {
    PTC_FareBreakdowns: {
      PTC_FareBreakdown: {
        PassengerFare: { TotalFare: { CurrencyCode: 'USD', Amount: 210.5 } },
      },
    },
  },
};

test('normalizes a direct itinerary', () => {
  const [flight] = normalizeFlightSearchResults({ PricedItineraries: [SAMPLE_ITINERARY] });

  assert.equal(flight.airline, 'B6');
  assert.equal(flight.flightNumber, 'B6666');
  assert.equal(flight.origin, 'JFK');
  assert.equal(flight.destination, 'LAX');
  assert.equal(flight.departureTime, '2026-09-01T11:00:00');
  assert.equal(flight.arrivalTime, '2026-09-01T17:00:00');
  assert.equal(flight.durationMinutes, 540);
  assert.equal(flight.stops, 0);
  assert.deepEqual(flight.price, { amount: 172.71, currency: 'USD' });
  assert.equal(flight.source, 'sabre');
});

test('normalizes a connecting itinerary, deriving origin/destination from first/last leg', () => {
  const [flight] = normalizeFlightSearchResults({ PricedItineraries: [CONNECTING_ITINERARY] });

  assert.equal(flight.origin, 'JFK');
  assert.equal(flight.destination, 'LAX');
  assert.equal(flight.stops, 1);
  assert.equal(flight.segments.length, 2);
  assert.equal(flight.segments[0].destination, 'ORD');
  assert.equal(flight.segments[1].origin, 'ORD');
  assert.equal(flight.durationMinutes, 390);
});

test('handles the empty-results fallback shape', () => {
  const results = normalizeFlightSearchResults({ PricedItineraries: [] });
  assert.deepEqual(results, []);
});

test('handles a completely missing PricedItineraries key', () => {
  assert.deepEqual(normalizeFlightSearchResults({}), []);
});

test('normalizes multiple itineraries in one response', () => {
  const results = normalizeFlightSearchResults({
    PricedItineraries: [SAMPLE_ITINERARY, CONNECTING_ITINERARY],
  });
  assert.equal(results.length, 2);
});
