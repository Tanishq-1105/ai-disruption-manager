import { apiClient } from './client.js';

export async function signup(email, password) {
  const { data } = await apiClient.post('/auth/signup', { email, password });
  return data;
}

export async function login(email, password) {
  const { data } = await apiClient.post('/auth/login', { email, password });
  return data;
}

export async function me() {
  const { data } = await apiClient.get('/auth/me');
  return data.user;
}

export async function searchFlights(params) {
  const { data } = await apiClient.get('/search/flights', { params });
  return data;
}

export async function searchHotels(params) {
  const { data } = await apiClient.get('/search/hotels', { params });
  return data;
}

export async function searchCabs(params) {
  const { data } = await apiClient.get('/search/cabs', { params });
  return data;
}

export async function trackTrip(tripId) {
  const { data } = await apiClient.get(`/trips/${encodeURIComponent(tripId)}/tracking`);
  return data;
}

export async function getHistory() {
  const { data } = await apiClient.get('/history');
  return data.results;
}

export async function getFlightQuote(offerId) {
  const { data } = await apiClient.post('/bookings/quote', { offerId });
  return data.quote;
}

export async function bookFlight(quote, passenger) {
  const { data } = await apiClient.post('/bookings', { quoteId: quote.id, version: quote.version, passenger }, {
    headers: { 'Idempotency-Key': quote.id },
  });
  return data.trip;
}

export async function getTrips() {
  const { data } = await apiClient.get('/trips');
  return data.results;
}

export async function getTrip(id) {
  const { data } = await apiClient.get(`/trips/${encodeURIComponent(id)}`);
  return data.trip;
}
