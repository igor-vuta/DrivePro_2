import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Screen, Title, Button, Segmented, StatusDot, Row } from '../ui';
import { useAuth } from '../state';
import { SERVER_HOST } from '../config';
import { t } from '../i18n';
import RideTab from './RideTab';
import DriveTab from './DriveTab';
import WeeklyRecap from '../WeeklyRecap';

export default function HomeScreen({ openProfile }) {
  const { me, wsConnected, activeRide } = useAuth();
  const [tab, setTab] = useState('ride');

  // When a ride becomes active, jump to the tab where it lives.
  useEffect(() => {
    if (activeRide && me) {
      setTab(activeRide.driverId === me.id ? 'drive' : 'ride');
    }
  }, [activeRide ? activeRide.id : null]);

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <View>
          <Title style={{ marginBottom: 0 }}>DrivePro</Title>
          <StatusDot
            on={wsConnected}
            labelOn={t('home.connected', { host: SERVER_HOST })}
            labelOff={t('home.connecting', { host: SERVER_HOST })}
          />
        </View>
        <Button kind="ghost" title={t('home.profile')} onPress={openProfile} style={{ height: 40, paddingHorizontal: 14 }} />
      </Row>

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ride', label: t('home.ride') },
          { value: 'drive', label: t('home.drive') },
        ]}
      />

      {tab === 'ride' ? <RideTab /> : <DriveTab openProfile={openProfile} />}
      <WeeklyRecap />
    </Screen>
  );
}
