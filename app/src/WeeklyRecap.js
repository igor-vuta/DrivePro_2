import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from './ui';
import { api } from './api';
import { useAuth } from './state';
import { t } from './i18n';

const SEEN_KEY = 'drivepro.weeklySeen';

function weekId(d = new Date()) {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86_400_000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${week}`;
}

// The Sunday ceremony: once a week, on first open, show what the movement did.
export default function WeeklyRecap() {
  const { token } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(SEEN_KEY);
        if (seen === weekId()) return;
        const r = await api('GET', '/api/weekly', null, token);
        if (!cancelled && r && r.city) setData(r);
      } catch (e) {}
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const close = async () => {
    setData(null);
    await AsyncStorage.setItem(SEEN_KEY, weekId()).catch(() => {});
  };

  if (!data) return null;

  const line = (txt, key) => (
    <Text key={key} style={{ color: colors.text, fontSize: 15, marginBottom: 4 }}>
      {txt}
    </Text>
  );

  return (
    <Modal transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 20, padding: 22, maxHeight: '85%' }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text, marginBottom: 2 }}>{t('weekly.title')}</Text>
          <Text style={{ color: colors.sub, marginBottom: 14 }}>{t('weekly.subtitle')}</Text>

          {data.city.rides === 0 ? (
            <Text style={{ color: colors.text, marginBottom: 14 }}>{t('weekly.empty')}</Text>
          ) : (
            <View>
              <Text style={{ fontWeight: '700', color: colors.sub, marginBottom: 6, textTransform: 'uppercase', fontSize: 12 }}>
                {t('weekly.you')}
              </Text>
              {line(`🚗  ${t('weekly.youDrove', { n: data.me.drove })}`, 'd')}
              {line(`🙋  ${t('weekly.youRode', { n: data.me.rode })}`, 'r')}
              {data.me.points ? line(`⚡  ${t('weekly.youEarned', { n: data.me.points })}`, 'p') : null}
              {data.me.streak ? line(`🔥  ${t('weekly.youStreak', { n: data.me.streak })}`, 's') : null}

              <Text
                style={{ fontWeight: '700', color: colors.sub, marginVertical: 6, textTransform: 'uppercase', fontSize: 12 }}
              >
                {t('weekly.city')}
              </Text>
              {line(`🤝  ${t('weekly.cityRides', { n: data.city.rides })}`, 'cr')}
              {line(`🛣  ${t('weekly.cityKm', { n: data.city.km })}`, 'ck')}
              {line(`🟢  ${t('weekly.cityDrivers', { n: data.city.drivers })}`, 'cd')}

              {data.city.top && data.city.top.length ? (
                <View style={{ marginTop: 8 }}>
                  <Text
                    style={{ fontWeight: '700', color: colors.sub, marginBottom: 6, textTransform: 'uppercase', fontSize: 12 }}
                  >
                    {t('weekly.top')}
                  </Text>
                  {data.city.top.map((u, i) => (
                    <Text key={i} style={{ color: colors.text, fontSize: 15, marginBottom: 3 }}>
                      {['🥇', '🥈', '🥉'][i]}  {u.name} — ⚡{u.points}
                    </Text>
                  ))}
                </View>
              ) : null}

              {data.city.crews && data.city.crews.length ? (
                <View style={{ marginTop: 8 }}>
                  <Text
                    style={{ fontWeight: '700', color: colors.sub, marginBottom: 6, textTransform: 'uppercase', fontSize: 12 }}
                  >
                    {t('weekly.crews')}
                  </Text>
                  {data.city.crews.map((c, i) => (
                    <Text key={i} style={{ color: colors.text, fontSize: 15, marginBottom: 3 }}>
                      {['🥇', '🥈', '🥉'][i]}  {c.name} — ⚡{c.points}
                    </Text>
                  ))}
                  {data.me.crew && data.me.crew.rank ? (
                    <Text style={{ color: colors.sub, fontSize: 13, marginTop: 4 }}>
                      🏴 {t('weekly.crewRank', { name: data.me.crew.name, rank: data.me.crew.rank })}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          )}

          <Pressable
            onPress={close}
            style={{
              marginTop: 16,
              backgroundColor: colors.primary,
              borderRadius: 14,
              paddingVertical: 13,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: colors.primaryText, fontWeight: '800', fontSize: 16 }}>{t('weekly.close')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
