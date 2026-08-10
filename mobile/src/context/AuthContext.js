import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as SecureStore from 'expo-secure-store';
import * as endpoints from '../api/endpoints.js';
import { TOKEN_KEY } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (token) {
        try {
          setUser(await endpoints.me());
        } catch {
          await SecureStore.deleteItemAsync(TOKEN_KEY);
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = useCallback(async (email, password) => {
    const { token, user: loggedInUser } = await endpoints.login(email, password);
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setUser(loggedInUser);
  }, []);

  const signup = useCallback(async (email, password) => {
    const { token, user: newUser } = await endpoints.signup(email, password);
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setUser(newUser);
  }, []);

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
