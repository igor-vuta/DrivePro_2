import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Screen, Title, Sub, Card, Button, Row, colors } from '../ui';
import { useAuth } from '../state';
import { api } from '../api';
import { t, errMsg } from '../i18n';
import { confirmAction } from '../dialogs';

// Saved commutes (L14), reachable from the avatar sheet. Creation stays on
// the ride confirmation screen - that is where a pickup and destination
// already exist - so this screen manages what has been saved: pause, resume,
// delete.
export default function SchedulesScreen({ goBack }) {
  const { token } = useAuth();
  const [schedules, setSchedules] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      const r = await api('GET', '/api/schedules', null, token);
      setSchedules(r.schedules || []);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const labels = t('sched.dow').split(',');
  const fmtDays = (s) =>
    s.date
      ? t('sched.once', { date: s.date })
      : s.days && s.days.length === 7
      ? t('sched.daily')
      : (s.days || []).map((d) => labels[d - 1]).join(' ');

  const toggle = (s) => api('PUT', `/api/schedules/${s.id}`, { active: !s.active }, token).then(load).catch(() => {});
  const del = (s) =>
    confirmAction({
      title: t('sched.deleteQ'),
      message: `${s.time} · ${s.dest.address || ''}`,
      okLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
      onOk: () => api('DELETE', `/api/schedules/${s.id}`, null, token).then(load).catch(() => {}),
    });

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <Button kind="ghost" title={t('common.back')} onPress={goBack} style={{ height: 40, paddingHorizontal: 14 }} />
      </Row>
      <Title>⏰ {t('sched.title')}</Title>
      {error ? <Sub>{error}</Sub> : null}
      {!schedules ? (
        <ActivityIndicator color={colors.text} style={{ marginTop: 30 }} />
      ) : (
        <ScrollView>
          {schedules.length === 0 ? <Sub>{t('sched.empty')}</Sub> : null}
          {schedules.map((s) => (
            <Card key={s.id}>
              <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ color: s.active ? colors.text : colors.sub, fontSize: 18, fontWeight: '800' }}>
                  {s.time}
                  <Text style={{ fontSize: 13, fontWeight: '600', color: colors.sub }}>  {fmtDays(s)}</Text>
                </Text>
                {!s.active ? (
                  <Text style={{ color: colors.gold, fontSize: 12, fontWeight: '700' }}>{t('sched.paused')}</Text>
                ) : null}
              </Row>
              <Text style={{ color: s.active ? colors.text : colors.sub, marginBottom: 2 }} numberOfLines={1}>
                {s.pickup.address || ''} → {s.dest.address || ''}
              </Text>
              <Row style={{ justifyContent: 'flex-end', marginTop: 6 }}>
                <Pressable onPress={() => toggle(s)} style={{ paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>
                    {s.active ? '⏸' : '▶️'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => del(s)} style={{ paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text style={{ color: colors.dangerInk, fontWeight: '700', fontSize: 13 }}>✕ {t('common.remove')}</Text>
                </Pressable>
              </Row>
            </Card>
          ))}
          <Sub style={{ marginTop: 6 }}>{t('sched.screenHint')}</Sub>
          <View style={{ height: 30 }} />
        </ScrollView>
      )}
    </Screen>
  );
}
