import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { notify, confirmAction } from '../dialogs';
import { Screen, Title, Sub, Card, Input, Button, ErrorText, Row, Avatar, Segmented, colors } from '../ui';
import { useAuth } from '../state';
import { api } from '../api';
import { t, errMsg, getLang } from '../i18n';

const MAX_AVATAR_CHARS = 380_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function ProfileScreen({ goBack, openHistory }) {
  const { token, me, saveProfile, saveCar, logout, langPref, setLanguage } = useAuth();
  const [comments, setComments] = useState([]);
  const [name, setName] = useState(me ? me.name : '');
  const [about, setAbout] = useState(me && me.about ? me.about : '');
  const [city, setCity] = useState(me && me.city ? me.city : '');
  const [email, setEmail] = useState(me && me.email ? me.email : '');
  const [carMake, setCarMake] = useState(me && me.car ? me.car.make : '');
  const [carModel, setCarModel] = useState(me && me.car ? me.car.model : '');
  const [carColor, setCarColor] = useState(me && me.car ? me.car.color : '');
  const [plate, setPlate] = useState(me && me.car ? me.car.plate : '');
  const [err, setErr] = useState('');
  const [carErr, setCarErr] = useState('');
  const [busyProfile, setBusyProfile] = useState(false);
  const [busyCar, setBusyCar] = useState(false);
  const [busyPhoto, setBusyPhoto] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!me) return undefined;
    (async () => {
      try {
        const r = await api('GET', `/api/users/${me.id}`, null, token);
        if (!cancelled) setComments(r.user.recentComments || []);
      } catch (e) {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!me) return null;

  const ratingText = me.rating != null ? `★ ${me.rating} (${me.ratingCount})` : t('modal.noRatings');

  const onSaveProfile = async () => {
    setErr('');
    if (name.trim().length < 2) {
      setErr(t('auth.vName'));
      return;
    }
    if (email.trim() && !EMAIL_RE.test(email.trim())) {
      setErr(t('err.invalid_email'));
      return;
    }
    setBusyProfile(true);
    try {
      await saveProfile({ name: name.trim(), about: about.trim(), city: city.trim(), email: email.trim() });
      notify(t('profile.saved'), t('profile.profileUpdated'));
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusyProfile(false);
    }
  };

  const onSaveCar = async () => {
    setCarErr('');
    if (!carMake.trim() || !carModel.trim() || !carColor.trim() || !plate.trim()) {
      setCarErr(t('profile.vCar'));
      return;
    }
    setBusyCar(true);
    try {
      await saveCar({ carMake: carMake.trim(), carModel: carModel.trim(), carColor: carColor.trim(), plate: plate.trim() });
      notify(t('profile.saved'), t('profile.carSaved'));
    } catch (e) {
      setCarErr(errMsg(e));
    } finally {
      setBusyCar(false);
    }
  };

  const pickPhoto = async () => {
    setBusyPhoto(true);
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.4,
        base64: true,
      });
      if (res.canceled || !res.assets || !res.assets[0]) return;
      const asset = res.assets[0];
      const dataUrl = `data:image/jpeg;base64,${asset.base64}`;
      if (dataUrl.length > MAX_AVATAR_CHARS) {
        notify(t('profile.saved'), t('profile.photoTooLarge'));
        return;
      }
      await saveProfile({ avatar: dataUrl });
    } catch (e) {
      notify(t('drive.error'), errMsg(e));
    } finally {
      setBusyPhoto(false);
    }
  };

  const removePhoto = async () => {
    try {
      await saveProfile({ avatar: null });
    } catch (e) {
      notify(t('drive.error'), errMsg(e));
    }
  };

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <Button kind="ghost" title={t('common.back')} onPress={goBack} style={{ height: 40, paddingHorizontal: 14 }} />
      </Row>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Row style={{ marginBottom: 4 }}>
          <Avatar user={me} size={64} style={{ marginRight: 14 }} />
          <View style={{ flex: 1 }}>
            <Title style={{ marginBottom: 0 }}>{me.name}</Title>
            <Sub style={{ marginBottom: 0 }}>
              {ratingText} · {me.ridesCount} {t('profile.rides', { n: me.ridesCount })} · ⚡ {me.points || 0}{' '}
            {t('profile.points', { n: me.points || 0 })}
            </Sub>
            <Sub style={{ marginBottom: 0 }}>
              {me.phone}
            </Sub>
          </View>
        </Row>
        <Row style={{ marginBottom: 12 }}>
          <Button
            kind="ghost"
            title={me.avatar ? t('profile.changePhoto') : t('profile.addPhoto')}
            onPress={pickPhoto}
            loading={busyPhoto}
            style={{ height: 38, paddingHorizontal: 12, marginRight: 8 }}
          />
          {me.avatar ? (
            <Button kind="ghost" title={t('profile.removePhoto')} onPress={removePhoto} style={{ height: 38, paddingHorizontal: 12 }} />
          ) : null}
        </Row>

        <Button kind="ghost" title={t('profile.history')} onPress={openHistory} style={{ marginBottom: 12 }} />

        {comments.length ? (
          <Card>
            <Text style={{ fontWeight: '700', marginBottom: 8, color: colors.text }}>{t('profile.say')}</Text>
            {comments.map((c, i) => (
              <View key={i} style={{ marginBottom: 8 }}>
                <Text style={{ color: colors.gold, fontSize: 13 }}>{'★'.repeat(c.stars)}</Text>
                <Text style={{ color: colors.text }}>{c.comment}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        <Card>
          <Text style={{ fontWeight: '700', marginBottom: 10, color: colors.text }}>{t('profile.personal')}</Text>
          <Input label={t('profile.name')} value={name} onChangeText={setName} autoCapitalize="words" maxLength={60} />
          <Input
            label={t('profile.about')}
            value={about}
            onChangeText={setAbout}
            placeholder={t('profile.aboutPh')}
            maxLength={200}
          />
          <Input
            label={t('profile.city')}
            value={city}
            onChangeText={setCity}
            placeholder={t('profile.cityPh')}
            autoCapitalize="words"
            maxLength={60}
          />
          <Input
            label={t('profile.email')}
            value={email}
            onChangeText={setEmail}
            placeholder={t('profile.emailPh')}
            keyboardType="email-address"
            autoComplete="email"
            maxLength={120}
          />
          <ErrorText>{err}</ErrorText>
          <Button title={t('profile.saveProfile')} onPress={onSaveProfile} loading={busyProfile} disabled={name.trim().length < 2} />
        </Card>

        <PlacesCard />

        <CrewCard />

        <Card>
          <Text style={{ fontWeight: '700', marginBottom: 4, color: colors.text }}>{t('profile.driver')}</Text>
          <Sub>{t('profile.fillCar')}</Sub>
          <Input label={t('profile.carMake')} value={carMake} onChangeText={setCarMake} placeholder={t('profile.carMakePh')} autoCapitalize="words" maxLength={40} />
          <Input label={t('profile.carModel')} value={carModel} onChangeText={setCarModel} placeholder={t('profile.carModelPh')} autoCapitalize="words" maxLength={40} />
          <Input label={t('profile.colour')} value={carColor} onChangeText={setCarColor} placeholder={t('profile.colourPh')} autoCapitalize="words" maxLength={30} />
          <Input label={t('profile.plate')} value={plate} onChangeText={setPlate} placeholder={t('profile.platePh')} autoCapitalize="characters" maxLength={16} />
          <ErrorText>{carErr}</ErrorText>
          <Button
            title={me.isDriver ? t('profile.updateCar') : t('profile.saveCar')}
            onPress={onSaveCar}
            loading={busyCar}
            disabled={!carMake || !carModel || !carColor || !plate}
          />
        </Card>

        <SecurityCard />

        <Card>
          <Text style={{ fontWeight: '700', marginBottom: 10, color: colors.text }}>{t('profile.language')}</Text>
          <Segmented
            value={langPref}
            onChange={(v) => setLanguage(v)}
            options={[
              { value: 'auto', label: t('profile.langAuto') },
              { value: 'ru', label: 'РУ' },
              { value: 'kk', label: 'ҚАЗ' },
              { value: 'en', label: 'EN' },
            ]}
          />
        </Card>

        <Button kind="ghost" title={t('profile.logout')} onPress={logout} />
        <View style={{ height: 40 }} />
      </ScrollView>
    </Screen>
  );
}

// ------------------------------------------------------------------- crew ---

// Private squad joined by invite code; points feed the crew total (L13).
function CrewCard() {
  const { token, refreshMe } = useAuth();
  const [data, setData] = useState(null); // null = loading, else /api/crews/mine payload
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api('GET', '/api/crews/mine', null, token);
        if (!cancelled) setData(r);
      } catch (e) {
        if (!cancelled) setData({ crew: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const act = async (path, body) => {
    setErr('');
    setBusy(true);
    try {
      const r = await api('POST', path, body, token);
      setData(r && r.crew !== undefined ? r : { crew: null });
      setName('');
      setCode('');
      refreshMe().catch(() => {});
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const crew = data && data.crew;
  return (
    <Card>
      <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text }}>🏴 {t('crew.title')}</Text>
      {!data ? null : crew ? (
        <View>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>{crew.name}</Text>
          <Sub>
            ⚡ {t('crew.total', { n: crew.points })} · {t('crew.week', { n: data.week ? data.week.points : 0 })}
          </Sub>
          <View
            style={{
              backgroundColor: '#0a1626',
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 10,
              marginBottom: 10,
            }}
          >
            <Sub style={{ marginBottom: 2, fontSize: 12 }}>{t('crew.codeLabel')}</Sub>
            <Text selectable style={{ color: colors.primary, fontSize: 22, fontWeight: '800', letterSpacing: 3 }}>
              {crew.code}
            </Text>
            <Sub style={{ marginBottom: 0, fontSize: 12 }}>{t('crew.shareHint')}</Sub>
          </View>
          {(data.members || []).map((m) => (
            <Row key={m.id} style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ color: colors.text, flexShrink: 1 }} numberOfLines={1}>
                {m.isOwner ? '⭐ ' : ''}
                {m.name}
                {m.streakDays ? ` 🔥${m.streakDays}` : ''}
              </Text>
              <Text style={{ color: colors.sub }}>⚡ {m.weekPoints}</Text>
            </Row>
          ))}
          <ErrorText>{err}</ErrorText>
          <Button
            kind="ghost"
            title={t('crew.leave')}
            loading={busy}
            onPress={() =>
              confirmAction({
                title: t('crew.leaveQ'),
                message: t('crew.leaveText'),
                okLabel: t('crew.leave'),
                cancelLabel: t('common.cancel'),
                onOk: () => act('/api/crews/leave'),
              })
            }
            style={{ marginTop: 4 }}
          />
        </View>
      ) : (
        <View>
          <Sub>{t('crew.none')}</Sub>
          <Row>
            <Input
              value={name}
              onChangeText={setName}
              placeholder={t('crew.namePh')}
              maxLength={30}
              containerStyle={{ flex: 1, marginBottom: 0 }}
            />
            <Button
              title={t('crew.create')}
              onPress={() => act('/api/crews', { name: name.trim() })}
              loading={busy}
              disabled={name.trim().length < 2}
              style={{ marginLeft: 8, height: 48, paddingHorizontal: 14, marginTop: 0 }}
            />
          </Row>
          <Sub style={{ marginVertical: 8 }}>{t('crew.or')}</Sub>
          <Row>
            <Input
              value={code}
              onChangeText={setCode}
              placeholder={t('crew.codePh')}
              autoCapitalize="characters"
              maxLength={8}
              containerStyle={{ flex: 1, marginBottom: 0 }}
            />
            <Button
              kind="ghost"
              title={t('crew.join')}
              onPress={() => act('/api/crews/join', { code: code.trim() })}
              loading={busy}
              disabled={code.trim().length < 4}
              style={{ marginLeft: 8, height: 48, paddingHorizontal: 14, marginTop: 0 }}
            />
          </Row>
          <ErrorText>{err}</ErrorText>
        </View>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ saved places ---

function PlacesCard() {
  const { token, me, savePlace } = useAuth();
  const [editing, setEditing] = useState(null); // 'home' | 'work' | null
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const places = (me && me.places) || {};

  const search = async () => {
    const q = query.trim();
    if (q.length < 2) return;
    setError('');
    setBusy(true);
    try {
      const r = await api('GET', `/api/geo/search?q=${encodeURIComponent(q)}&lang=${getLang()}`, null, token);
      setResults(r.results || []);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const choose = async (r) => {
    try {
      await savePlace(editing, { lat: r.lat, lng: r.lng, address: r.address });
      setEditing(null);
      setQuery('');
      setResults(null);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const remove = async (kind) => {
    try {
      await savePlace(kind, null);
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const rowFor = (kind, icon) => {
    const p = places[kind];
    return (
      <View style={{ marginBottom: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={{ color: colors.text, fontWeight: '600' }}>
              {icon} {t(`profile.${kind}`)}
            </Text>
            <Sub style={{ marginBottom: 0 }}>{p ? p.address : t('profile.notSet')}</Sub>
          </View>
          <Row>
            <Button
              kind="ghost"
              title={p ? t('common.change') : t('common.set')}
              onPress={() => {
                setEditing(editing === kind ? null : kind);
                setResults(null);
                setQuery('');
                setError('');
              }}
              style={{ height: 36, paddingHorizontal: 10, marginRight: 6 }}
            />
            {p ? (
              <Button kind="ghost" title={t('common.remove')} onPress={() => remove(kind)} style={{ height: 36, paddingHorizontal: 10 }} />
            ) : null}
          </Row>
        </Row>
        {editing === kind ? (
          <View style={{ marginTop: 8 }}>
            <Row>
              <Input
                value={query}
                onChangeText={setQuery}
                placeholder={t('profile.placeSearchPh')}
                returnKeyType="search"
                onSubmitEditing={search}
                containerStyle={{ flex: 1, marginBottom: 0 }}
              />
              <Button title={t('common.find')} onPress={search} loading={busy} style={{ marginLeft: 8, height: 48, paddingHorizontal: 16, marginTop: 0 }} />
            </Row>
            {results
              ? results.map((r, i) => (
                  <Pressable key={i} onPress={() => choose(r)} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border }}>
                    <Text style={{ color: colors.text }}>{r.address}</Text>
                    <Text style={{ color: colors.sub, fontSize: 12 }} numberOfLines={1}>
                      {r.fullAddress}
                    </Text>
                  </Pressable>
                ))
              : null}
            {results && !results.length ? <Sub>{t('ride.nothingFound')}</Sub> : null}
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Card>
      <Text style={{ fontWeight: '700', marginBottom: 10, color: colors.text }}>{t('profile.places')}</Text>
      {rowFor('home', '🏠')}
      {rowFor('work', '💼')}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

// ------------------------------------------------------------- security ---
//
// An authenticator app is optional and additive: the verified phone stays the
// account's identity, and resetting the password over it clears any secret
// here - which is why there are no recovery codes to lose.
function SecurityCard() {
  const { totpEnabled, totpSetup, totpEnable, totpDisable } = useAuth();
  const [secret, setSecret] = useState(null);
  const [otpauth, setOtpauth] = useState(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const begin = async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await totpSetup();
      setSecret(r.secret);
      setOtpauth(r.otpauth);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (fn) => {
    setErr('');
    setBusy(true);
    try {
      await fn(code.trim());
      setCode('');
      setSecret(null);
      setOtpauth(null);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const field = (
    <Input
      label={t('totp.codeLabel')}
      value={code}
      onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
      placeholder={t('totp.codePh')}
      keyboardType="number-pad"
      maxLength={6}
      style={{ textAlign: 'center', fontSize: 22, letterSpacing: 6 }}
    />
  );

  return (
    <Card>
      <Text style={{ fontWeight: '700', marginBottom: 4, color: colors.text }}>{t('totp.title')}</Text>
      <Sub>{totpEnabled ? t('totp.on') : t('totp.off')}</Sub>

      {totpEnabled ? (
        <View>
          {field}
          <ErrorText>{err}</ErrorText>
          <Button kind="ghost" title={t('totp.disable')} onPress={() => finish(totpDisable)} loading={busy} disabled={code.length !== 6} />
        </View>
      ) : secret ? (
        <View>
          <Sub>{t('totp.setupHint')}</Sub>
          {/* Shown as text rather than a QR: encoding one would need a
              dependency, and every authenticator accepts manual entry. */}
          <Text selectable style={{ color: colors.gold, fontFamily: 'monospace', fontSize: 15, marginBottom: 8, letterSpacing: 1 }}>
            {secret}
          </Text>
          <Text selectable style={{ color: colors.sub, fontSize: 11, marginBottom: 10 }} numberOfLines={2}>
            {otpauth}
          </Text>
          {field}
          <ErrorText>{err}</ErrorText>
          <Button title={t('totp.confirm')} onPress={() => finish(totpEnable)} loading={busy} disabled={code.length !== 6} />
        </View>
      ) : (
        <View>
          <ErrorText>{err}</ErrorText>
          <Button kind="ghost" title={t('totp.enable')} onPress={begin} loading={busy} />
        </View>
      )}
    </Card>
  );
}
