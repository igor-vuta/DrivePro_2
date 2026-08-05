import React, { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { AuthProvider, useAuth } from './src/state';
import AuthScreen from './src/screens/AuthScreen';
import VerifyScreen from './src/screens/VerifyScreen';
import HomeScreen from './src/screens/HomeScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import RateScreen from './src/screens/RateScreen';
import PermissionsScreen from './src/screens/PermissionsScreen';
import { DialogHost } from './src/dialogs';
import { Button, colors } from './src/ui';
import { t } from './src/i18n';

const PERM_KEY = 'drivepro.permDone';

function Root() {
  const { booting, token, pendingRating, pendingVerification } = useAuth();
  const [screen, setScreen] = useState('home'); // 'home' | 'profile' | 'history'
  const [permState, setPermState] = useState('unknown'); // 'unknown' | 'needed' | 'done'

  // Android hardware back: history -> profile -> home.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'history') {
        setScreen('profile');
        return true;
      }
      if (screen === 'profile') {
        setScreen('home');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen]);

  useEffect(() => {
    if (!token) setScreen('home');
  }, [token]);

  // First thing after signing in: the permissions step (once).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const done = await AsyncStorage.getItem(PERM_KEY);
        if (done) {
          if (!cancelled) setPermState('done');
          return;
        }
        const cur = await Location.getForegroundPermissionsAsync();
        if (cur && cur.granted) {
          await AsyncStorage.setItem(PERM_KEY, '1').catch(() => {});
          if (!cancelled) setPermState('done');
          return;
        }
        if (!cancelled) setPermState('needed');
      } catch (e) {
        if (!cancelled) setPermState('needed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const finishPermissions = async () => {
    await AsyncStorage.setItem(PERM_KEY, '1').catch(() => {});
    setPermState('done');
  };

  if (booting) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    );
  }

  if (!token) return pendingVerification ? <VerifyScreen /> : <AuthScreen />;

  if (permState === 'unknown') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.text} />
      </View>
    );
  }
  if (permState === 'needed') return <PermissionsScreen onDone={finishPermissions} />;

  if (pendingRating) return <RateScreen />;

  if (screen === 'profile') {
    return <ProfileScreen goBack={() => setScreen('home')} openHistory={() => setScreen('history')} />;
  }
  if (screen === 'history') {
    return <HistoryScreen goBack={() => setScreen('profile')} />;
  }
  return <HomeScreen openProfile={() => setScreen('profile')} />;
}

// Renders a recoverable message instead of the white screen a render crash
// would otherwise leave behind on web.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      const msg = String((this.state.error && this.state.error.message) || this.state.error);
      return (
        <View style={{ flex: 1, justifyContent: 'center', padding: 28, backgroundColor: colors.bg }}>
          <Text style={{ fontSize: 40, textAlign: 'center', marginBottom: 10 }}>😵</Text>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>
            {t('app.crashTitle')}
          </Text>
          <Text style={{ color: colors.sub, textAlign: 'center', marginBottom: 18 }} numberOfLines={4}>
            {msg}
          </Text>
          <Button
            title={t('app.reload')}
            onPress={() => {
              if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.reload();
              else this.setState({ error: null });
            }}
          />
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <AuthProvider>
      <View style={{ flex: 1 }}>
        <StatusBar style="light" />
        <ErrorBoundary>
          <Root />
        </ErrorBoundary>
        <DialogHost />
      </View>
    </AuthProvider>
  );
}
