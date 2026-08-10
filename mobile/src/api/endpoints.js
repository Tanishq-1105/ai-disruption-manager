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

export async function trackFlight(flightNumber) {
  const { data } = await apiClient.get(`/tracking/${encodeURIComponent(flightNumber)}`);
  return data;
}

export async function getHistory() {
  const { data } = await apiClient.get('/history');
  return data.results;
}
