import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { wsClient } from './ws';

const TOKEN_KEY = 'drivepro.token';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState(null);
  const [me, setMe] = useState(null); // public profile of the signed-in user
  const [driverActive, setDriverActive] = useState(false);
  const [activeRide, setActiveRide] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);

  // Restore session on app start.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(TOKEN_KEY);
        if (saved && !cancelled) {
          const data = await api('GET', '/api/me', null, saved);
          if (cancelled) return;
          setToken(saved);
          setMe(data.user);
          setDriverActive(!!data.driverActive);
          setActiveRide(data.activeRide || null);
        }
      } catch (e) {
        await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the websocket in sync with the session.
  useEffect(() => {
    if (!token) return undefined;
    wsClient.connect(token);
    const offConn = wsClient.on('connection', ({ connected }) => setWsConnected(connected));
    const offHello = wsClient.on('hello', (msg) => {
      if (msg.user) setMe(msg.user);
      setDriverActive(!!msg.driverActive);
    });
    const offStatus = wsClient.on('driver:status', (msg) => setDriverActive(!!msg.active));
    return () => {
      offConn();
      offHello();
      offStatus();
      wsClient.disconnect();
    };
  }, [token]);

  const value = useMemo(
    () => ({
      booting,
      token,
      me,
      driverActive,
      activeRide,
      wsConnected,
      setActiveRide,
      setDriverActive,

      async register(phone, password, name) {
        const data = await api('POST', '/api/register', { phone, password, name });
        await AsyncStorage.setItem(TOKEN_KEY, data.token);
        setMe(data.user);
        setToken(data.token);
      },

      async login(phone, password) {
        const data = await api('POST', '/api/login', { phone, password });
        await AsyncStorage.setItem(TOKEN_KEY, data.token);
        setMe(data.user);
        setToken(data.token);
      },

      async logout() {
        await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
        setToken(null);
        setMe(null);
        setDriverActive(false);
        setActiveRide(null);
      },

      async refreshMe() {
        if (!token) return;
        const data = await api('GET', '/api/me', null, token);
        setMe(data.user);
        setDriverActive(!!data.driverActive);
        setActiveRide(data.activeRide || null);
      },

      async saveName(name) {
        const data = await api('PUT', '/api/me', { name }, token);
        setMe(data.user);
      },

      async saveCar(car) {
        const data = await api('PUT', '/api/me/driver', car, token);
        setMe(data.user);
      },
    }),
    [booting, token, me, driverActive, activeRide, wsConnected]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
