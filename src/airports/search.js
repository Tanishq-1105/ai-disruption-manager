import { config } from '../config.js';
import { HttpError } from '../errors.js';
import * as duffel from '../duffel/client.js';

const GOOGLE_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const GOOGLE_PLACE_URL = 'https://places.googleapis.com/v1/places';
const AIRPORT_TYPES = new Set(['airport', 'international_airport', 'domestic_airport', 'regional_airport']);
const NON_PASSENGER_AIRPORT_TYPES = new Set(['heliport', 'seaplane_base', 'airstrip']);
const MAX_AIRPORT_DISTANCE_METERS = 5_000;
const MIN_NEAREST_AIRPORT_MARGIN_METERS = 500;

function googleKey(apiKey) {
  if (!apiKey) throw new HttpError(503, 'AIRPORT_SEARCH_UNAVAILABLE', 'Airport search is not configured.');
  return apiKey;
}

async function googleJson(response) {
  const body = await response.json();
  if (!response.ok) {
    throw new HttpError(503, 'AIRPORT_SEARCH_UNAVAILABLE', 'Google airport search is temporarily unavailable.');
  }
  return body;
}

export async function autocompleteAirports(input, {
  apiKey = config.googlePlaces.apiKey,
  fetchImpl = fetch,
} = {}) {
  const response = await fetchImpl(GOOGLE_AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': googleKey(apiKey),
      'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types',
    },
    body: JSON.stringify({
      input,
      includedPrimaryTypes: ['airport'],
      includeQueryPredictions: false,
    }),
  });
  const body = await googleJson(response);
  return (body.suggestions ?? []).flatMap(({ placePrediction }) => {
    const types = placePrediction?.types ?? [];
    const isAirport = types[0] === 'airport' || types.some(type => type !== 'airport' && AIRPORT_TYPES.has(type));
    if (!placePrediction || !isAirport || types.some(type => NON_PASSENGER_AIRPORT_TYPES.has(type))) return [];
    return [{
      placeId: placePrediction.placeId,
      text: placePrediction.text?.text ?? '',
      mainText: placePrediction.structuredFormat?.mainText?.text ?? placePrediction.text?.text ?? '',
      secondaryText: placePrediction.structuredFormat?.secondaryText?.text ?? '',
    }];
  }).filter((place) => place.placeId && place.mainText);
}

function distanceMeters(first, second) {
  const radians = degrees => degrees * Math.PI / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function matchDuffelAirport(places, location) {
  const byCode = new Map();
  for (const place of places ?? []) {
    if (place.type !== 'airport' || !/^[A-Z]{3}$/.test(place.iata_code ?? '')
        || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) continue;
    const distance = distanceMeters(location, { latitude: place.latitude, longitude: place.longitude });
    if (distance > MAX_AIRPORT_DISTANCE_METERS) continue;
    const current = byCode.get(place.iata_code);
    if (!current || distance < current.distance) byCode.set(place.iata_code, { place, distance });
  }
  const matches = [...byCode.values()].sort((a, b) => a.distance - b.distance);
  if (!matches.length || (matches[1]
      && matches[1].distance - matches[0].distance < MIN_NEAREST_AIRPORT_MARGIN_METERS)) return null;
  return matches[0].place;
}

export async function resolveAirport(placeId, {
  apiKey = config.googlePlaces.apiKey,
  fetchImpl = fetch,
  suggestDuffelPlaces = duffel.suggestPlaces,
} = {}) {
  const key = googleKey(apiKey);
  const detailsResponse = await fetchImpl(`${GOOGLE_PLACE_URL}/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'id,displayName,primaryType,types,location,addressComponents',
    },
  });
  const details = await googleJson(detailsResponse);
  if (!AIRPORT_TYPES.has(details.primaryType) || details.types?.some(type => NON_PASSENGER_AIRPORT_TYPES.has(type))
      || !details.location
      || !Number.isFinite(details.location.latitude) || !Number.isFinite(details.location.longitude)) return null;

  const city = details.addressComponents?.find(component => component.types?.includes('locality'))?.longText;
  const places = await suggestDuffelPlaces({
    query: city ?? details.displayName?.text ?? '',
    latitude: details.location.latitude,
    longitude: details.location.longitude,
  });
  const airport = matchDuffelAirport(places, details.location);
  if (!airport) return null;

  return {
    name: details.displayName?.text ?? airport.name,
    city: airport.city_name ?? airport.city?.name ?? '',
    iata_code: airport.iata_code,
  };
}