import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { Screen, Title, Sub, Card, Input, PhoneInput, Button, ErrorText, Segmented } from '../ui';
import { useAuth } from '../state';
import { t, errMsg } from '../i18n';
import { passkeysSupported } from '../passkey';

function validPhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
}

// Mirrors passwordProblem() in server/src/util.js so the rules are stated
// before a round trip; the server stays the authority. Returns an err.* key.
function passwordProblem(password, phone) {
  if (password.length < 8) return 'err.password_short';
  if (!/\p{L}/u.test(password) || !/[0-9]/.test(password)) return 'err.password_weak';
  const phoneDigits = String(phone || '').replace(/\D/g, '');
  if (phoneDigits.length >= 7) {
    const pwDigits = password.replace(/\D/g, '');
    if (pwDigits.includes(phoneDigits) || pwDigits.includes(phoneDigits.slice(-7))) return 'err.password_has_phone';
  }
  return null;
}

export default function AuthScreen() {
  const { login, register, requestReset, confirmReset, passkeyLogin } = useAuth();
  const [mode, setMode] = useState('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [totpCode, setTotpCode] = useState(''); // shown only once the server asks
  const [needsTotp, setNeedsTotp] = useState(false);

  // Password reset lives in this screen as a sub-flow: ask for the phone, then
  // for the code plus a new password. Confirming it logs straight in.
  const [resetting, setResetting] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [code, setCode] = useState('');
  const [resetDevCode, setResetDevCode] = useState(null);

  const leaveReset = () => {
    setResetting(false);
    setResetSent(false);
    setCode('');
    setResetDevCode(null);
    setPassword('');
    setError('');
  };

  const validate = () => {
    if (mode === 'register' && name.trim().length < 2) return t('auth.vName');
    if (!validPhone(phone)) return t('auth.vPhone');
    if (mode === 'register') {
      const problem = passwordProblem(password, phone);
      if (problem) return t(problem);
    }
    if (mode === 'login' && !password) return t('err.password_short');
    return null;
  };

  const run = async (fn) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    if (mode === 'login') {
      try {
        setError('');
        setBusy(true);
        await login(phone, password, totpCode.trim() || undefined);
      } catch (e) {
        // Not a failure: the password was right and a code is now needed.
        if (e && e.needsTotp) setTotpCode((c) => c || '');
        setError(e && e.needsTotp ? '' : errMsg(e));
        if (e && e.needsTotp) setNeedsTotp(true);
      } finally {
        setBusy(false);
      }
      return;
    }
    await run(() => register(phone, password, name));
  };

  const usePasskey = async () => {
    if (!validPhone(phone)) {
      setError(t('auth.vPhone'));
      return;
    }
    await run(() => passkeyLogin(phone));
  };

  const sendResetCode = async () => {
    if (!validPhone(phone)) {
      setError(t('auth.vPhone'));
      return;
    }
    await run(async () => {
      const dev = await requestReset(phone);
      setResetDevCode(dev);
      setResetSent(true);
      setPassword('');
    });
  };

  const submitReset = async () => {
    if (!/^\d{4}$/.test(code.trim())) {
      setError(t('verify.vCode'));
      return;
    }
    const problem = passwordProblem(password, phone);
    if (problem) {
      setError(t(problem));
      return;
    }
    await run(() => confirmReset(phone, code.trim(), password));
  };

  if (resetting) {
    return (
      <Screen>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
            <Title style={{ textAlign: 'center' }}>{t('reset.title')}</Title>
            <Sub style={{ textAlign: 'center', marginBottom: 20 }}>
              {resetSent ? t('reset.subCode', { phone }) : t('reset.subPhone')}
            </Sub>
            <Card>
              {resetSent ? (
                <>
                  <Input
                    label={t('reset.code')}
                    value={code}
                    onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 4))}
                    placeholder={t('verify.codePh')}
                    keyboardType="number-pad"
                    maxLength={4}
                    style={{ textAlign: 'center', fontSize: 24, letterSpacing: 8 }}
                  />
                  {resetDevCode ? (
                    <Sub style={{ textAlign: 'center' }}>{t('verify.devCode', { code: resetDevCode })}</Sub>
                  ) : null}
                  <Input
                    label={t('reset.newPassword')}
                    value={password}
                    onChangeText={setPassword}
                    placeholder={t('auth.passwordPh')}
                    secureTextEntry
                    maxLength={100}
                  />
                  <ErrorText>{error}</ErrorText>
                  <Button
                    title={t('reset.confirm')}
                    onPress={submitReset}
                    loading={busy}
                    disabled={code.length !== 4 || !password}
                  />
                </>
              ) : (
                <>
                  <PhoneInput label={t('auth.phone')} value={phone} onChangeText={setPhone} />
                  <ErrorText>{error}</ErrorText>
                  <Button title={t('reset.sendCode')} onPress={sendResetCode} loading={busy} disabled={!phone} />
                </>
              )}
              <Button kind="ghost" title={t('reset.back')} onPress={leaveReset} style={{ marginTop: 8 }} />
            </Card>
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
          <Title glow style={{ fontSize: 38, textAlign: 'center', letterSpacing: 2 }}>DRIVEPRO</Title>
          <Sub style={{ textAlign: 'center', marginBottom: 24 }}>{t('auth.tagline')}</Sub>

          <Segmented
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError('');
              setNeedsTotp(false);
              setTotpCode('');
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

          <PhoneInput label={t('auth.phone')} value={phone} onChangeText={setPhone} />
          <Input
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            placeholder={t('auth.passwordPh')}
            secureTextEntry
            maxLength={100}
          />
          {needsTotp ? (
            <Input
              label={t('totp.codeLabel')}
              value={totpCode}
              onChangeText={(v) => setTotpCode(v.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('totp.codePh')}
              keyboardType="number-pad"
              maxLength={6}
              style={{ textAlign: 'center', fontSize: 22, letterSpacing: 6 }}
            />
          ) : null}

          <ErrorText>{error}</ErrorText>

          <Button
            title={mode === 'login' ? t('auth.login') : t('auth.createAccount')}
            onPress={submit}
            loading={busy}
            disabled={!phone || !password || (mode === 'register' && name.trim().length < 2)}
          />
          {mode === 'login' && passkeysSupported() ? (
            <Button kind="ghost" title={t('passkey.login')} onPress={usePasskey} loading={busy} style={{ marginTop: 8 }} />
          ) : null}
          {mode === 'login' ? (
            <Button
              kind="ghost"
              title={t('reset.forgot')}
              onPress={() => {
                setError('');
                setPassword('');
                setResetting(true);
              }}
              style={{ marginTop: 8 }}
            />
          ) : null}
          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
