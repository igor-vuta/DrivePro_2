import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Screen, Title, Sub, Card, Button, FadeIn, Row, colors } from '../ui';
import { t } from '../i18n';

// First-run explainer, shown once between signing up and the permissions ask.
// Order matters: what DrivePro is (people misread it as a taxi app), then how
// each side uses it, and only then the points economy - which means nothing
// until you know what earns them. The last step hands over to the permission
// screen, so it deliberately does not mention permissions itself.

const STEPS = ['what', 'rider', 'driver', 'points'];
const ICONS = { what: '🚗', rider: '👋', driver: '🚙', points: '⚡' };

export default function GuideScreen({ onDone }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <FadeIn keyId={step} from={18}>
          <Text style={{ fontSize: 56, textAlign: 'center', marginBottom: 12 }}>{ICONS[step]}</Text>
          <Title style={{ textAlign: 'center' }}>{t(`guide.${step}.title`)}</Title>
          <Sub style={{ textAlign: 'center', marginBottom: 20 }}>{t(`guide.${step}.text`)}</Sub>
        </FadeIn>

        <Card>
          <Row style={{ justifyContent: 'center', marginBottom: 4 }}>
            {STEPS.map((s, n) => (
              <View
                key={s}
                style={{
                  width: n === i ? 20 : 8,
                  height: 8,
                  borderRadius: 4,
                  marginHorizontal: 4,
                  backgroundColor: n === i ? colors.primary : colors.border,
                  ...(n === i
                    ? {
                        shadowColor: colors.primary,
                        shadowOpacity: 0.8,
                        shadowRadius: 6,
                        shadowOffset: { width: 0, height: 0 },
                      }
                    : {}),
                }}
              />
            ))}
          </Row>
          <Button
            title={last ? t('guide.start') : t('guide.next')}
            onPress={() => (last ? onDone() : setI((n) => n + 1))}
          />
          {last ? null : <Button kind="ghost" title={t('guide.skip')} onPress={onDone} style={{ marginTop: 8 }} />}
        </Card>
      </View>
    </Screen>
  );
}
