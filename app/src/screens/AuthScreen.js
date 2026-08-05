import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Screen, Title, Sub, Input, Button, ErrorText, Segmented } from '../ui';
import { useAuth } from '../state';

export default function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(phone, password);
      } else {
        await register(phone, password, name);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
          <Title style={{ fontSize: 34, textAlign: 'center' }}>DrivePro</Title>
          <Sub style={{ textAlign: 'center', marginBottom: 24 }}>Rides between people. No fares, no fuss.</Sub>

          <Segmented
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError('');
            }}
            options={[
              { value: 'login', label: 'Log in' },
              { value: 'register', label: 'Sign up' },
            ]}
          />

          {mode === 'register' ? (
            <Input label="Your name" value={name} onChangeText={setName} placeholder="e.g. Igor" autoCapitalize="words" />
          ) : null}

          <Input
            label="Phone number"
            value={phone}
            onChangeText={setPhone}
            placeholder="+44 7700 900123"
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 4 characters"
            secureTextEntry
          />

          <ErrorText>{error}</ErrorText>

          <Button
            title={mode === 'login' ? 'Log in' : 'Create account'}
            onPress={submit}
            loading={busy}
            disabled={!phone || !password || (mode === 'register' && name.trim().length < 2)}
          />
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
