import { Platform } from 'react-native';
import { api } from './api';

// WebAuthn from the browser. Web only: the native shell would need a
// different bridge, and the app is a PWA for now.
//
// The tricky part is purely mechanical - the browser wants ArrayBuffers and
// hands back ArrayBuffers, while the server speaks base64url over JSON.

const toB64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64url = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

export function passkeysSupported() {
  return (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    !!(navigator.credentials && navigator.credentials.create)
  );
}

// Registers this device against the signed-in account.
export async function registerPasskey(token, label) {
  const opts = await api('POST', '/api/passkey/register/options', {}, token);
  const cred = await navigator.credentials.create({
    publicKey: {
      ...opts,
      challenge: fromB64url(opts.challenge),
      user: { ...opts.user, id: fromB64url(opts.user.id) },
    },
  });
  if (!cred) throw new Error('cancelled');
  await api(
    'POST',
    '/api/passkey/register',
    {
      challenge: opts.challenge,
      attestationObject: toB64url(cred.response.attestationObject),
      clientDataJSON: toB64url(cred.response.clientDataJSON),
      label,
    },
    token
  );
  return true;
}

// Signs in with a registered device. The phone only says which credentials to
// offer - the signature is what authenticates.
export async function loginWithPasskey(phone) {
  const opts = await api('POST', '/api/passkey/login/options', { phone });
  const cred = await navigator.credentials.get({
    publicKey: {
      ...opts,
      challenge: fromB64url(opts.challenge),
      allowCredentials: (opts.allowCredentials || []).map((c) => ({ ...c, id: fromB64url(c.id) })),
    },
  });
  if (!cred) throw new Error('cancelled');
  return api('POST', '/api/passkey/login', {
    challenge: opts.challenge,
    credentialId: toB64url(cred.rawId),
    authenticatorData: toB64url(cred.response.authenticatorData),
    clientDataJSON: toB64url(cred.response.clientDataJSON),
    signature: toB64url(cred.response.signature),
  });
}
