import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Screen, Title, Sub, Input, Button, ErrorText, Segmented } from '../ui';
import { useAuth } from '../state';
import { t, errMsg } from '../i18n';

function validPhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

export default function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const validate = () => {
    if (mode === 'register' && name.trim().length < 2) return t('auth.vName');
    if (!validPhone(phone)) return t('auth.vPhone');
    if (mode === 'register' && password.length < 6) return t('auth.vPassword');
    if (mode === 'login' && !password) return t('auth.vPassword');
    return null;
  };

  const submit = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(phone, password);
      } else {
        await register(phone, password, name);
      }
    } catch (e) {
      setError(errMsg(e));
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
          <Sub style={{ textAlign: 'center', marginBottom: 24 }}>{t('auth.tagline')}</Sub>

          <Segmented
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError('');
            }}
            options={[
              { value: 'login', label: t('auth.login') },
              { value: 'register', label: t('auth.signup') },
            ]}
          />

          {mode === 'register' ? (
            <Input
              label={t('auth.yourName')}
              value={name}
              onChangeText={setName}
              placeholder={t('auth.namePh')}
              autoCapitalize="words"
              maxLength={60}
            />
          ) : null}

          <Input
            label={t('auth.phone')}
            value={phone}
            onChangeText={setPhone}
            placeholder="+44 7700 900123"
            keyboardType="phone-pad"
            autoComplete="tel"
            maxLength={20}
          />
          <Input
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            placeholder={t('auth.passwordPh')}
            secureTextEntry
            maxLength={100}
          />

          <ErrorText>{error}</ErrorText>

          <Button
            title={mode === 'login' ? t('auth.login') : t('auth.createAccount')}
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
