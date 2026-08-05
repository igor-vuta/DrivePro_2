import React, { useState } from 'react';
import { Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Screen, Title, Sub, Card, Button, colors } from '../ui';
import { t } from '../i18n';

// One-time permissions step shown right after signing in: ask for location
// up front so the map and driver matching work without surprise prompts later.

export default function PermissionsScreen({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);

  const allow = async () => {
    setBusy(true);
    try {
      const res = await Location.requestForegroundPermissionsAsync();
      if (res && res.granted) {
        onDone();
        return;
      }
      setDenied(true);
    } catch (e) {
      setDenied(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={{ fontSize: 56, textAlign: 'center', marginBottom: 12 }}>📍</Text>
        <Title style={{ textAlign: 'center' }}>{t('perm.title')}</Title>
        <Sub style={{ textAlign: 'center', marginBottom: 20 }}>{t('perm.text')}</Sub>
        <Card>
          <Text style={{ color: colors.text, marginBottom: 4 }}>{t('perm.point1')}</Text>
          <Text style={{ color: colors.text, marginBottom: 4 }}>{t('perm.point2')}</Text>
          <Text style={{ color: colors.text }}>{t('perm.point3')}</Text>
        </Card>
        {denied ? <Sub style={{ textAlign: 'center' }}>{t('perm.deniedNote')}</Sub> : null}
        <Button title={t('perm.allow')} onPress={allow} loading={busy} />
        <Button kind="ghost" title={t('perm.skip')} onPress={onDone} style={{ marginTop: 8 }} />
      </View>
    </Screen>
  );
}
