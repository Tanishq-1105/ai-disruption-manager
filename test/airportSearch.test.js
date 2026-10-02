import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autocompleteAirports, resolveAirport } from '../src/airports/search.js';

test('Google Places New autocomplete requests airports worldwide and excludes non-airports', async () => {
  let request;
  const results = await autocompleteAirports('mum', {
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return Response.json({ suggestions: [
        { placePrediction: { placeId: 'airport-12345', text: { text: 'Mumbai Airport' },
          structuredFormat: { mainText: { text: 'Mumbai Airport' } }, types: ['airport', 'establishment'] } },
        { placePrediction: { placeId: 'heliport-12345', text: { text: 'Mumbai Heliport' },
          types: ['transportation_service', 'heliport', 'airport'] } },
        { placePrediction: { placeId: 'club-12345', text: { text: 'Mumbai Flying Club' },
          types: ['establishment', 'airport'] } },
      ] });
    },
  });

  assert.equal(request.url, 'https://places.googleapis.com/v1/places:autocomplete');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['X-Goog-Api-Key'], 'test-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    input: 'mum', includedPrimaryTypes: ['airport'], includeQueryPredictions: false,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].placeId, 'airport-12345');
});

test('airport resolution returns Duffel airport IATA code and never its city code', async () => {
  const urls = [];
  const airport = await resolveAirport('google-airport-12345', {
    apiKey: 'test-key',
    fetchImpl: async url => {
      urls.push(url);
      return Response.json({ id: 'google-airport-12345', primaryType: 'international_airport',
        types: ['international_airport', 'airport'],
        displayName: { text: 'Chhatrapati Shivaji Maharaj International Airport' },
        location: { latitude: 19.0896, longitude: 72.8656 },
        addressComponents: [{ longText: 'Mumbai', types: ['locality', 'political'] }] });
    },
    suggestDuffelPlaces: async query => {
      assert.equal(query.query, 'Mumbai');
      return [
        { type: 'city', iata_code: 'MUM', latitude: 19.0896, longitude: 72.8656 },
        { type: 'airport', iata_code: 'BOM', iata_city_code: 'MUM', city_name: 'Mumbai', name: 'Mumbai Airport',
          latitude: 19.0897, longitude: 72.8657 },
      ];
    },
  });

  assert.equal(urls[0], 'https://places.googleapis.com/v1/places/google-airport-12345');
  assert.deepEqual(airport, {
    name: 'Chhatrapati Shivaji Maharaj International Airport', city: 'Mumbai', iata_code: 'BOM',
  });
});

test('airport resolution fails closed for non-airports, missing Duffel matches, and ambiguous nearby airports', async () => {
  const google = primaryType => async () => Response.json({ primaryType,
    displayName: { text: 'Selected place' }, location: { latitude: 19, longitude: 72 } });
  assert.equal(await resolveAirport('place-12345', { apiKey: 'test-key', fetchImpl: google('locality') }), null);
  assert.equal(await resolveAirport('place-12345', {
    apiKey: 'test-key', fetchImpl: google('airport'), suggestDuffelPlaces: async () => [],
  }), null);
  assert.equal(await resolveAirport('place-12345', {
    apiKey: 'test-key', fetchImpl: google('airport'), suggestDuffelPlaces: async () => [
      { type: 'airport', iata_code: 'AAA', latitude: 19, longitude: 72 },
      { type: 'airport', iata_code: 'BBB', latitude: 19.0001, longitude: 72 },
    ],
  }), null);
});