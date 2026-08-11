import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Card, Button, Input, Sub, ErrorText, Row, colors } from './ui';
import { useAuth } from './state';
import { api } from './api';
import { t, errMsg } from './i18n';
import { confirmAction } from './dialogs';

// Private squad joined by invite code; points feed the crew total (L13).
// Shared by the profile screen and the crew screen behind the avatar sheet.
export default function CrewCard() {
  const { token, refreshMe } = useAuth();
  const [data, setData] = useState(null); // null = loading, else /api/crews/mine payload
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api('GET', '/api/crews/mine', null, token);
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) setData({ crew: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const act = async (path, body) => {
    setErr('');
    setBusy(true);
    try {
      const r = await api('POST', path, body, token);
      setData(r && r.crew !== undefined ? r : { crew: null });
      setName('');
      setCode('');
      refreshMe().catch(() => {});
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const crew = data && data.crew;
  return (
    <Card>
      <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text }}>🏴 {t('crew.title')}</Text>
      {!data ? null : crew ? (
        <View>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{crew.name}</Text>
          <Sub>
            ⚡ {t('crew.total', { n: crew.points })} · {t('crew.week', { n: data.week ? data.week.points : 0 })}
          </Sub>
          <View
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 10,
              marginBottom: 10,
            }}
          >
            <Sub style={{ marginBottom: 2, fontSize: 12 }}>{t('crew.codeLabel')}</Sub>
            <Text selectable style={{ color: colors.primaryInk, fontSize: 22, fontWeight: '800', letterSpacing: 3 }}>
              {crew.code}
            </Text>
            <Sub style={{ marginBottom: 0, fontSize: 12 }}>{t('crew.shareHint')}</Sub>
          </View>
          {(data.members || []).map((m) => (
            <Row key={m.id} style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ color: colors.text, flexShrink: 1 }} numberOfLines={1}>
                {m.isOwner ? '⭐ ' : ''}
                {m.name}
                {m.streakDays ? ` 🔥${m.streakDays}` : ''}
              </Text>
              <Text style={{ color: colors.sub }}>⚡ {m.weekPoints}</Text>
            </Row>
          ))}
          <ErrorText>{err}</ErrorText>
          <Button
            kind="ghost"
            title={t('crew.leave')}
            loading={busy}
            onPress={() =>
              confirmAction({
                title: t('crew.leaveQ'),
                message: t('crew.leaveText'),
                okLabel: t('crew.leave'),
                cancelLabel: t('common.cancel'),
                onOk: () => act('/api/crews/leave'),
              })
            }
            style={{ marginTop: 4 }}
          />
        </View>
      ) : (
        <View>
          <Sub>{t('crew.none')}</Sub>
          <Row>
            <Input
              value={name}
              onChangeText={setName}
              placeholder={t('crew.namePh')}
              maxLength={30}
              containerStyle={{ flex: 1, marginBottom: 0 }}
            />
            <Button
              title={t('crew.create')}
              onPress={() => act('/api/crews', { name: name.trim() })}
              loading={busy}
              disabled={name.trim().length < 2}
              style={{ marginLeft: 8, height: 48, paddingHorizontal: 14, marginTop: 0 }}
            />
          </Row>
          <Sub style={{ marginVertical: 8 }}>{t('crew.or')}</Sub>
          <Row>
            <Input
              value={code}
              onChangeText={setCode}
              placeholder={t('crew.codePh')}
              autoCapitalize="characters"
              maxLength={8}
              containerStyle={{ flex: 1, marginBottom: 0 }}
            />
            <Button
              kind="ghost"
              title={t('crew.join')}
              onPress={() => act('/api/crews/join', { code: code.trim() })}
              loading={busy}
              disabled={code.trim().length < 4}
              style={{ marginLeft: 8, height: 48, paddingHorizontal: 14, marginTop: 0 }}
            />
          </Row>
          <ErrorText>{err}</ErrorText>
        </View>
      )}
    </Card>
  );
}
