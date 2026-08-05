import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Vibration } from 'react-native';
import { notify } from './dialogs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { wsClient } from './ws';
import { t, setLang, resolveLang } from './i18n';

const TOKEN_KEY = 'drivepro.token';
const LANG_KEY = 'drivepro.lang';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState(null);
  const [me, setMe] = useState(null); // public profile of the signed-in user
  const [driverActive, setDriverActive] = useState(false);
  const [activeRide, setActiveRide] = useState(null);
  const [driverRides, setDriverRides] = useState([]); // convoy: [{ ride, rider }]
  const [counterpart, setCounterpart] = useState(null);
  const [driverLoc, setDriverLoc] = useState(null);
  const [pendingRating, setPendingRating] = useState(null); // { ride, counterpart: {id, name} }
  const [pendingVerification, setPendingVerification] = useState(null); // { phone, devCode }
  const [langPref, setLangPref] = useState('auto'); // 'auto' | 'en' | 'ru'
  const [lang, setLangState] = useState('ru');
  const [wsConnected, setWsConnected] = useState(false);
  const meRef = useRef(null);
  useEffect(() => {
    meRef.current = me;
  }, [me]);
  const rideRef = useRef(null);
  useEffect(() => {
    rideRef.current = activeRide;
  }, [activeRide]);
  const driverRidesRef = useRef([]);
  useEffect(() => {
    driverRidesRef.current = driverRides;
  }, [driverRides]);
  const counterpartRef = useRef(null);
  useEffect(() => {
    counterpartRef.current = counterpart;
  }, [counterpart]);

  // Restore session on app start.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const savedLang = await AsyncStorage.getItem(LANG_KEY);
        const pref = savedLang || 'auto';
        const resolved = resolveLang(pref);
        setLang(resolved);
        if (!cancelled) {
          setLangPref(pref);
          setLangState(resolved);
        }
        const saved = await AsyncStorage.getItem(TOKEN_KEY);
        if (saved && !cancelled) {
          const data = await api('GET', '/api/me', null, saved);
          if (cancelled) return;
          setToken(saved);
          setMe(data.user);
          setDriverActive(!!data.driverActive);
          setActiveRide(data.activeRide || null);
          setCounterpart(data.counterpart || null);
          setDriverLoc(data.driverLocation || null);
          setDriverRides(data.driverRides || []);
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

  // When the app regains focus (tab becomes visible on web, foreground on
  // phones), reconnect immediately and re-sync state from the server.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      wsClient.kick();
      const tk = tokenRef.current;
      if (tk) {
        api('GET', '/api/me', null, tk)
          .then((data) => {
            setMe(data.user);
            setDriverActive(!!data.driverActive);
            setActiveRide(data.activeRide || null);
            setCounterpart(data.counterpart || null);
            setDriverLoc(data.driverLocation || null);
            setDriverRides(data.driverRides || []);
          })
          .catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);
  const tokenRef = useRef(null);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  // Keep the websocket in sync with the session.
  useEffect(() => {
    if (!token) return undefined;
    wsClient.connect(token);
    const offConn = wsClient.on('connection', ({ connected }) => setWsConnected(connected));
    const offHello = wsClient.on('hello', (msg) => {
      if (msg.user) setMe(msg.user);
      setDriverActive(!!msg.driverActive);
      setActiveRide(msg.activeRide || null);
      setCounterpart(msg.counterpart || null);
      setDriverLoc(msg.driverLocation || null);
      setDriverRides(msg.driverRides || []);
    });
    const offStatus = wsClient.on('driver:status', (msg) => setDriverActive(!!msg.active));
    const offCreated = wsClient.on('ride:created', (msg) => {
      setActiveRide(msg.ride);
      setCounterpart(null);
      setDriverLoc(null);
    });
    const offUpdate = wsClient.on('ride:update', (msg) => {
      const r = msg.ride;
      if (msg.counterpart) setCounterpart(msg.counterpart);
      if (msg.driverLocation) setDriverLoc(msg.driverLocation);
      const my0 = meRef.current;
      const iAmDriver = !!(my0 && r.driverId === my0.id);
      if (r.status === 'finished') {
        let remaining = driverRidesRef.current || [];
        const entry = remaining.find((x) => x.ride.id === r.id);
        if (iAmDriver) {
          remaining = remaining.filter((x) => x.ride.id !== r.id);
          setDriverRides(remaining);
        }
        setActiveRide(iAmDriver && remaining.length ? remaining[0].ride : null);
        setDriverLoc(null);
        const c = iAmDriver ? (entry && entry.rider) || counterpartRef.current : counterpartRef.current;
        setCounterpart(null);
        if (msg.pointsEarned && iAmDriver) {
          notify(t('rate.finished'), t('drive.pointsEarned', { n: msg.pointsEarned }));
          api('GET', '/api/me', null, token)
            .then((data) => {
              if (data && data.user) setMe(data.user);
            })
            .catch(() => {});
        }
        // A driver still carrying passengers keeps driving - they can rate
        // later from the history screen.
        if (!iAmDriver || remaining.length === 0) {
          setPendingRating({ ride: r, counterpart: c ? { id: c.id, name: c.name } : null });
        }
        return;
      }
      if (iAmDriver) {
        setDriverRides((prev) => {
          const others = prev.filter((x) => x.ride.id !== r.id);
          const existing = prev.find((x) => x.ride.id === r.id);
          const rider = msg.counterpart || (existing ? existing.rider : null);
          return [...others, { ride: r, rider }].sort((a, b) => a.ride.createdAt - b.ride.createdAt);
        });
      }
      const prev = rideRef.current;
      setActiveRide(r);
      const my = meRef.current;
      if (my && r.riderId === my.id && r.status === 'arrived' && (!prev || prev.status !== 'arrived')) {
        Vibration.vibrate([0, 400, 200, 400]);
        const c = counterpartRef.current;
        notify(
          t('note.arrivedTitle'),
          c && c.car
            ? t('note.lookFor', { color: c.car.color, make: c.car.make, model: c.car.model, plate: c.car.plate })
            : t('note.meetPickup')
        );
      }
    });
    const offDriverLoc = wsClient.on('ride:driver_location', (msg) => setDriverLoc({ lat: msg.lat, lng: msg.lng }));
    const offRating = wsClient.on('rating:received', async () => {
      try {
        const data = await api('GET', '/api/me', null, token);
        setMe(data.user);
      } catch (e) {}
    });
    const offCancelled = wsClient.on('ride:cancelled', (msg) => {
      const myD = meRef.current;
      if (myD && msg.ride && msg.ride.driverId === myD.id) {
        const rem = (driverRidesRef.current || []).filter((x) => x.ride.id !== msg.ride.id);
        setDriverRides(rem);
        setActiveRide(rem.length ? rem[0].ride : null);
      } else {
        setActiveRide(null);
      }
      setCounterpart(null);
      setDriverLoc(null);
      const my = meRef.current;
      if (my && msg.ride) {
        const mySide = msg.ride.riderId === my.id ? 'rider' : 'driver';
        if (msg.ride.cancelledBy && msg.ride.cancelledBy !== mySide) {
          notify(t('note.rideCancelled'), msg.ride.cancelledBy === 'rider' ? t('note.byRider') : t('note.byDriver'));
        }
      }
    });
    return () => {
      offConn();
      offHello();
      offStatus();
      offCreated();
      offUpdate();
      offDriverLoc();
      offRating();
      offCancelled();
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
      driverRides,
      counterpart,
      driverLoc,
      pendingRating,
      setPendingRating,
      pendingVerification,
      langPref,
      lang,
      wsConnected,
      setActiveRide,
      setDriverActive,

      async submitRating(rideId, starsValue, comment) {
        await api('POST', `/api/rides/${rideId}/rating`, { stars: starsValue, comment }, token);
      },

      async register(phone, password, name) {
        const data = await api('POST', '/api/register', { phone, password, name });
        if (data.needsVerification) {
          setPendingVerification({ phone: data.phone, devCode: data.devCode || null });
        }
      },

      async login(phone, password) {
        try {
          const data = await api('POST', '/api/login', { phone, password });
          await AsyncStorage.setItem(TOKEN_KEY, data.token);
          setMe(data.user);
          setToken(data.token);
        } catch (e) {
          if (e.data && e.data.needsVerification) {
            setPendingVerification({ phone: e.data.phone, devCode: e.data.devCode || null });
            return;
          }
          throw e;
        }
      },

      async verifyPhone(code) {
        if (!pendingVerification) return;
        const data = await api('POST', '/api/verify', { phone: pendingVerification.phone, code });
        await AsyncStorage.setItem(TOKEN_KEY, data.token);
        setPendingVerification(null);
        setMe(data.user);
        setToken(data.token);
      },

      async resendCode() {
        if (!pendingVerification) return;
        const data = await api('POST', '/api/resend', { phone: pendingVerification.phone });
        setPendingVerification({ phone: data.phone, devCode: data.devCode || null });
      },

      cancelVerification() {
        setPendingVerification(null);
      },

      async setLanguage(pref) {
        await AsyncStorage.setItem(LANG_KEY, pref).catch(() => {});
        const resolved = resolveLang(pref);
        setLang(resolved);
        setLangPref(pref);
        setLangState(resolved);
      },

      async logout() {
        await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
        setToken(null);
        setMe(null);
        setDriverActive(false);
        setActiveRide(null);
        setDriverRides([]);
        setCounterpart(null);
        setDriverLoc(null);
      },

      async refreshMe() {
        if (!token) return;
        const data = await api('GET', '/api/me', null, token);
        setMe(data.user);
        setDriverActive(!!data.driverActive);
        setActiveRide(data.activeRide || null);
        setCounterpart(data.counterpart || null);
        setDriverLoc(data.driverLocation || null);
        setDriverRides(data.driverRides || []);
      },

      async saveProfile(patch) {
        const data = await api('PUT', '/api/me', patch, token);
        if (data && data.user) setMe(data.user);
      },

      async savePlace(kind, place) {
        const data = await api('PUT', '/api/me/places', { [kind]: place }, token);
        if (data && data.user) setMe(data.user);
      },

      async saveCar(car) {
        const data = await api('PUT', '/api/me/driver', car, token);
        if (data && data.user) setMe(data.user);
      },
    }),
    [booting, token, me, driverActive, activeRide, driverRides, counterpart, driverLoc, pendingRating, pendingVerification, langPref, lang, wsConnected]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
