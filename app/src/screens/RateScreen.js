import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { notify } from '../dialogs';
import { Screen, Title, Sub, Card, Input, Button, colors } from '../ui';
import { useAuth } from '../state';
import { t, errMsg } from '../i18n';

export default function RateScreen() {
  const { pendingRating, setPendingRating, submitRating } = useAuth();
  const [starsValue, setStarsValue] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  if (!pendingRating) return null;
  const { ride, counterpart } = pendingRating;
  const name = counterpart ? counterpart.name : t('rate.counterpart');

  const close = () => setPendingRating(null);

  const submit = async () => {
    setBusy(true);
    try {
      await submitRating(ride.id, starsValue, comment.trim());
      close();
    } catch (e) {
      notify(t('rate.couldNotSave'), errMsg(e));
      close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
          <Title style={{ textAlign: 'center' }}>{t('rate.finished')}</Title>
          <Sub style={{ textAlign: 'center', marginBottom: 20 }}>
            {ride.pickupAddress} → {ride.destAddress}
          </Sub>

          <Card>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, textAlign: 'center', marginBottom: 12 }}>
              {t('rate.how', { name })}
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 14 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} onPress={() => setStarsValue(n)} hitSlop={6}>
                  <Text style={{ fontSize: 40, marginHorizontal: 6, color: n <= starsValue ? '#f5a623' : '#d9d9d9' }}>
                    ★
                  </Text>
                </Pressable>
              ))}
            </View>
            <Input
              value={comment}
              onChangeText={setComment}
              placeholder={t('rate.commentPh')}
              multiline
              style={{ height: 80, paddingTop: 12, textAlignVertical: 'top' }}
            />
            <Button title={t('rate.submit')} onPress={submit} loading={busy} disabled={!starsValue} />
            <Button kind="ghost" title={t('rate.skip')} onPress={close} style={{ marginTop: 8 }} />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
