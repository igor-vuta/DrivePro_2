import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView } from 'react-native';
import { Screen, Title, Sub, Card, Input, Button, ErrorText } from '../ui';
import { useAuth } from '../state';
import { t, errMsg } from '../i18n';

const RESEND_SECONDS = 30;

export default function VerifyScreen() {
  const { pendingVerification, verifyPhone, resendCode, cancelVerification, startTelegramLink, pollTelegramLink } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);
  const [tgState, setTgState] = useState('idle'); // idle | waiting | mismatch
  const pollRef = useRef(null);

  // Stop polling if the user leaves this screen.
  useEffect(() => () => clearInterval(pollRef.current), []);

  useEffect(() => {
    setCooldown(RESEND_SECONDS);
    const timer = setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, [pendingVerification && pendingVerification.devCode]);

  if (!pendingVerification) return null;

  const submit = async () => {
    if (!/^\d{4}$/.test(code.trim())) {
      setError(t('verify.vCode'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      await verifyPhone(code.trim());
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  // Opens the bot and waits for it to confirm the number with Telegram. The
  // account is verified without any code being typed, so success here signs
  // the user straight in - pollTelegramLink stores the session.
  const viaTelegram = async () => {
    setError('');
    try {
      const { nonce, url } = await startTelegramLink();
      if (!url) return;
      setTgState('waiting');
      await Linking.openURL(url);
      clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const status = await pollTelegramLink(nonce);
          if (status === 'mismatch') {
            clearInterval(pollRef.current);
            setTgState('idle');
            setError(t('verify.tgMismatch'));
          }
        } catch (e) {
          clearInterval(pollRef.current);
          setTgState('idle');
          setError(errMsg(e));
        }
      }, 2000);
    } catch (e) {
      setTgState('idle');
      setError(errMsg(e));
    }
  };

  const resend = async () => {
    setError('');
    try {
      await resendCode();
      setCode('');
    } catch (e) {
      setError(errMsg(e));
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
          <Title style={{ textAlign: 'center' }}>{t('verify.title')}</Title>
          <Sub style={{ textAlign: 'center', marginBottom: 20 }}>
            {t('verify.sentTo', { phone: pendingVerification.phone })}
          </Sub>
          <Card>
            <Input
              value={code}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 4))}
              placeholder={t('verify.codePh')}
              keyboardType="number-pad"
              maxLength={4}
              style={{ textAlign: 'center', fontSize: 24, letterSpacing: 8 }}
            />
            {pendingVerification.devCode ? (
              <Sub style={{ textAlign: 'center' }}>{t('verify.devCode', { code: pendingVerification.devCode })}</Sub>
            ) : null}
            <ErrorText>{error}</ErrorText>
            <Button title={t('verify.button')} onPress={submit} loading={busy} disabled={code.length !== 4} />
            <Button
              kind="ghost"
              title={cooldown > 0 ? t('verify.resendIn', { s: cooldown }) : t('verify.resend')}
              onPress={resend}
              disabled={cooldown > 0}
              style={{ marginTop: 8 }}
            />
            {pendingVerification.telegram ? (
              <Button
                kind="ghost"
                title={tgState === 'waiting' ? t('verify.tgWaiting') : t('verify.tgButton')}
                onPress={viaTelegram}
                disabled={tgState === 'waiting'}
                style={{ marginTop: 8 }}
              />
            ) : null}
            <Button kind="ghost" title={t('verify.changePhone')} onPress={cancelVerification} style={{ marginTop: 4 }} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
