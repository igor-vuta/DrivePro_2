import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Card, Button, Row, colors } from './ui';
import { t } from './i18n';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Today's hours, in one line. A place with no schedule says nothing rather
// than guessing - "closed" would be a lie when the provider simply has no data.
function todayHours(schedule) {
  if (!schedule) return null;
  if (schedule.is24x7) return t('place.open24');
  const today = schedule[DAYS[new Date().getDay()]];
  if (!today || !today.length) return t('place.closedToday');
  return `${t('place.today')} ${today.map((h) => `${h.from}–${h.to}`).join(', ')}`;
}

// What a tapped place looks like: what it is, where, when it is open, and the
// one action that matters - route me there.
export default function PlaceCard({ place, onGo, onClose }) {
  if (!place) return null;
  const hours = todayHours(place.schedule);
  return (
    <Card style={{ marginBottom: 0 }}>
      <Row style={{ alignItems: 'flex-start', marginBottom: 6 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '800' }} numberOfLines={2}>
            {place.name}
          </Text>
          {place.categories && place.categories.length ? (
            <Text style={{ color: colors.primaryInk, fontSize: 12, fontWeight: '700', marginTop: 1 }} numberOfLines={1}>
              {place.categories.join(' · ')}
            </Text>
          ) : null}
          <Text style={{ color: colors.sub, fontSize: 13, marginTop: 2 }} numberOfLines={2}>
            {place.address || place.fullAddress || ''}
          </Text>
          {hours ? (
            <Text style={{ color: colors.sub, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
              🕒 {hours}
            </Text>
          ) : null}
          {place.phones && place.phones.length ? (
            <Pressable onPress={() => Linking.openURL(`tel:${place.phones[0].replace(/[^\d+]/g, '')}`)}>
              <Text style={{ color: colors.primaryInk, fontSize: 13, marginTop: 2, fontWeight: '700' }}>
                📞 {place.phones[0]}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable onPress={onClose} hitSlop={10} style={{ paddingLeft: 8 }}>
          <Text style={{ color: colors.sub, fontSize: 20, fontWeight: '700' }}>✕</Text>
        </Pressable>
      </Row>
      <Button title={t('place.goHere')} onPress={() => onGo(place)} style={{ marginTop: 4 }} />
    </Card>
  );
}
