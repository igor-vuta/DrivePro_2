import React, { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Screen, Title, Sub, Card, Input, Button, ErrorText, Row, colors } from '../ui';
import { useAuth } from '../state';

export default function ProfileScreen({ goBack }) {
  const { me, saveName, saveCar, logout } = useAuth();
  const [name, setName] = useState(me ? me.name : '');
  const [carMake, setCarMake] = useState(me && me.car ? me.car.make : '');
  const [carModel, setCarModel] = useState(me && me.car ? me.car.model : '');
  const [carColor, setCarColor] = useState(me && me.car ? me.car.color : '');
  const [plate, setPlate] = useState(me && me.car ? me.car.plate : '');
  const [err, setErr] = useState('');
  const [busyName, setBusyName] = useState(false);
  const [busyCar, setBusyCar] = useState(false);

  if (!me) return null;

  const ratingText = me.rating != null ? `★ ${me.rating} (${me.ratingCount})` : 'No ratings yet';

  const onSaveName = async () => {
    setErr('');
    setBusyName(true);
    try {
      await saveName(name);
      Alert.alert('Saved', 'Your name has been updated.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyName(false);
    }
  };

  const onSaveCar = async () => {
    setErr('');
    setBusyCar(true);
    try {
      await saveCar({ carMake, carModel, carColor, plate });
      Alert.alert('Saved', 'Car details saved. You can now go online in Drive mode.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyCar(false);
    }
  };

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <Button kind="ghost" title="‹ Back" onPress={goBack} style={{ height: 40, paddingHorizontal: 14 }} />
      </Row>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Title>{me.name}</Title>
        <Sub>
          {ratingText} · {me.ridesCount} rides · {me.phone}
        </Sub>

        <Card>
          <Text style={{ fontWeight: '700', marginBottom: 10, color: colors.text }}>Personal details</Text>
          <Input label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
          <Button title="Save name" onPress={onSaveName} loading={busyName} disabled={name.trim().length < 2} />
        </Card>

        <Card>
          <Text style={{ fontWeight: '700', marginBottom: 4, color: colors.text }}>Driver details</Text>
          <Sub>Fill in your car to unlock Drive mode.</Sub>
          <Input label="Car make" value={carMake} onChangeText={setCarMake} placeholder="Volkswagen" autoCapitalize="words" />
          <Input label="Car model" value={carModel} onChangeText={setCarModel} placeholder="Golf" autoCapitalize="words" />
          <Input label="Colour" value={carColor} onChangeText={setCarColor} placeholder="Black" autoCapitalize="words" />
          <Input label="Plate" value={plate} onChangeText={setPlate} placeholder="AB12 CDE" autoCapitalize="characters" />
          <Button
            title={me.isDriver ? 'Update car' : 'Save car & become a driver'}
            onPress={onSaveCar}
            loading={busyCar}
            disabled={!carMake || !carModel || !carColor || !plate}
          />
        </Card>

        <ErrorText>{err}</ErrorText>

        <Button kind="ghost" title="Log out" onPress={logout} />
        <View style={{ height: 40 }} />
      </ScrollView>
    </Screen>
  );
}
