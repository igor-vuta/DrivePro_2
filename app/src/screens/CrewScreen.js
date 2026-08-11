import React from 'react';
import { ScrollView, View } from 'react-native';
import { Screen, Title, Button, Row } from '../ui';
import { t } from '../i18n';
import CrewCard from '../CrewCard';

// The crew, straight from the avatar sheet - create/join by invite code,
// weekly standings, leave. The card itself is shared with the profile screen.
export default function CrewScreen({ goBack }) {
  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <Button kind="ghost" title={t('common.back')} onPress={goBack} style={{ height: 40, paddingHorizontal: 14 }} />
      </Row>
      <Title>🏴 {t('crew.title')}</Title>
      <ScrollView keyboardShouldPersistTaps="handled">
        <CrewCard />
        <View style={{ height: 30 }} />
      </ScrollView>
    </Screen>
  );
}
