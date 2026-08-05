import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Screen, Title, Sub, Card, Button, Row, colors } from '../ui';
import { useAuth } from '../state';
import { api } from '../api';
import UserProfileModal from '../UserProfileModal';
import { t, errMsg } from '../i18n';

const statusLabel = (s) => t(`history.${s}`);

function fmtWhen(ts) {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function fmtKm(m) {
  if (m == null) return '';
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
}

export default function HistoryScreen({ goBack }) {
  const { token, setPendingRating } = useAuth();
  const [rides, setRides] = useState(null);
  const [error, setError] = useState('');
  const [profileUserId, setProfileUserId] = useState(null);

  const load = async () => {
    setError('');
    try {
      const r = await api('GET', '/api/rides', null, token);
      setRides(r.rides);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const rateRide = (r) => {
    setPendingRating({
      ride: r,
      counterpart: r.counterpartId ? { id: r.counterpartId, name: r.counterpartName } : null,
    });
  };

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <Button kind="ghost" title={t('common.back')} onPress={goBack} style={{ height: 40, paddingHorizontal: 14 }} />
        <Button kind="ghost" title={t('history.refresh')} onPress={load} style={{ height: 40, paddingHorizontal: 14 }} />
      </Row>
      <Title>{t('history.title')}</Title>
      {error ? <Sub>{error}</Sub> : null}
      {!rides ? (
        <ActivityIndicator color={colors.text} style={{ marginTop: 30 }} />
      ) : rides.length === 0 ? (
        <Sub>{t('history.empty')}</Sub>
      ) : (
        <ScrollView>
          {rides.map((r) => (
            <Card key={r.id}>
              <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ color: colors.sub, fontSize: 12 }}>
                  {fmtWhen(r.createdAt)} · {r.role === 'rider' ? t('history.youRode') : t('history.youDrove')}
                </Text>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '700',
                    color: r.status === 'finished' ? colors.ok : r.status === 'cancelled' ? colors.danger : colors.sub,
                  }}
                >
                  {statusLabel(r.status)}
                </Text>
              </Row>
              <Text style={{ color: colors.text, marginBottom: 2 }} numberOfLines={1}>
                {r.pickupAddress} → {r.destAddress}
              </Text>
              <Row style={{ justifyContent: 'space-between' }}>
                <Sub style={{ marginBottom: 0 }}>
                  {r.counterpartName ? (
                    <Text onPress={() => setProfileUserId(r.counterpartId)} style={{ textDecorationLine: 'underline' }}>
                      {r.counterpartName}
                    </Text>
                  ) : (
                    t('history.noDriver')
                  )}
                  {r.distanceM ? ` · ${fmtKm(r.distanceM)}` : ''}
                </Sub>
                {r.status === 'finished' && r.counterpartId ? (
                  r.myRating ? (
                    <Text style={{ color: colors.gold }}>{'★'.repeat(r.myRating.stars)}</Text>
                  ) : (
                    <Pressable onPress={() => rateRide(r)}>
                      <Text style={{ color: colors.text, fontWeight: '700' }}>{t('history.rate')}</Text>
                    </Pressable>
                  )
                ) : null}
              </Row>
            </Card>
          ))}
          <View style={{ height: 30 }} />
        </ScrollView>
      )}
      <UserProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />
    </Screen>
  );
}
