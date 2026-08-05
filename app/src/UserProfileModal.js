import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Card, Sub, Button, Avatar, colors } from './ui';
import { api } from './api';
import { useAuth } from './state';
import { t, errMsg } from './i18n';

// Small profile card shown when tapping a person's name anywhere in the app -
// lets riders and drivers check each other out before and during a ride.

export default function UserProfileModal({ userId, onClose }) {
  const { token } = useAuth();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setError('');
    if (!userId) return undefined;
    (async () => {
      try {
        const r = await api('GET', `/api/users/${userId}`, null, token);
        if (!cancelled) setProfile(r.user);
      } catch (e) {
        if (!cancelled) setError(errMsg(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const memberSince = profile ? new Date(profile.createdAt).toLocaleDateString() : '';

  return (
    <Modal visible={!!userId} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 }}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colors.bg, borderRadius: 16, padding: 16, maxHeight: '75%' }}>
          {!profile && !error ? (
            <ActivityIndicator color={colors.text} style={{ marginVertical: 30 }} />
          ) : error ? (
            <Sub>{error}</Sub>
          ) : (
            <ScrollView>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Avatar user={profile} size={54} style={{ marginRight: 12 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text }}>{profile.name}</Text>
                  <Sub style={{ marginBottom: 0 }}>
                    {profile.rating != null
                      ? t('modal.ratings', { avg: profile.rating, n: profile.ratingCount })
                      : t('modal.noRatings')}
                  </Sub>
                  <Sub style={{ marginBottom: 0 }}>{t('modal.meta', { rides: profile.ridesCount, date: memberSince })}</Sub>
                </View>
              </View>
              {profile.points ? <Sub style={{ marginBottom: 2 }}>⚡ {profile.points} {t('profile.points')}</Sub> : null}
              {profile.city ? <Sub style={{ marginBottom: 2 }}>📍 {profile.city}</Sub> : null}
              {profile.about ? <Sub>{profile.about}</Sub> : null}
              {profile.isDriver && profile.car ? (
                <Card style={{ marginTop: 4 }}>
                  <Text style={{ fontWeight: '700', color: colors.text, marginBottom: 2 }}>{t('modal.car')}</Text>
                  <Sub style={{ marginBottom: 0 }}>
                    {profile.car.color} {profile.car.make} {profile.car.model} · {profile.car.plate}
                  </Sub>
                </Card>
              ) : null}
              {profile.recentComments && profile.recentComments.length ? (
                <Card style={{ marginTop: 4 }}>
                  <Text style={{ fontWeight: '700', color: colors.text, marginBottom: 6 }}>{t('modal.say')}</Text>
                  {profile.recentComments.map((c, i) => (
                    <View key={i} style={{ marginBottom: 8 }}>
                      <Text style={{ color: '#f5a623', fontSize: 13 }}>{'★'.repeat(c.stars)}</Text>
                      <Text style={{ color: colors.text }}>{c.comment}</Text>
                    </View>
                  ))}
                </Card>
              ) : null}
            </ScrollView>
          )}
          <Button kind="ghost" title={t('common.close')} onPress={onClose} style={{ marginTop: 8 }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
