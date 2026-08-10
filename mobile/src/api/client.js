import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

export const TOKEN_KEY = 'auth_token';

export const apiClient = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_BASE_URL,
});

apiClient.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
