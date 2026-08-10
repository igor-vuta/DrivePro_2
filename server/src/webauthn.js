import crypto from 'node:crypto';

// Passkeys (WebAuthn / FIDO2), verified without a dependency.
//
// Only the parts this app needs are implemented: registration with `none`
// attestation (we do not care which brand of authenticator it is, only that
// the device holds the private key) and assertion verification for login.
//
// Like TOTP, a passkey is an optional convenience. The verified phone stays
// the identity and the recovery path - resetting the password over it removes
// every registered passkey, so a lost device is not a lost account.
//
// Structures, for reference while reading:
//   clientDataJSON  { type, challenge, origin, crossOrigin }   (JSON)
//   authenticatorData  rpIdHash(32) flags(1) signCount(4) [attestedCredData]
//   attestationObject  CBOR { fmt, attStmt, authData }

const RP_NAME = 'DrivePro';
// The relying-party id is the registrable domain; credentials are bound to it,
// so moving hosts invalidates every passkey. Derived from the public origin.
export const rpId = () => {
  const origin = process.env.PUBLIC_ORIGIN || 'https://drivepro-almaty.duckdns.org';
  try {
    return new URL(origin).hostname;
  } catch {
    return 'localhost';
  }
};
export const rpOrigins = () =>
  (process.env.WEBAUTHN_ORIGINS || process.env.PUBLIC_ORIGIN || 'https://drivepro-almaty.duckdns.org')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const fromB64url = (s) => Buffer.from(String(s || ''), 'base64url');

// ------------------------------------------------------------------ CBOR ---
//
// A deliberately small decoder: enough for an attestation object, which is a
// map of text keys to a map, a byte string and a text string. Anything more
// exotic than that throws rather than guessing.
function cborDecode(buf, start = 0) {
  let i = start;
  const readLen = (info) => {
    if (info < 24) return info;
    if (info === 24) return buf[i++];
    if (info === 25) {
      const v = buf.readUInt16BE(i);
      i += 2;
      return v;
    }
    if (info === 26) {
      const v = buf.readUInt32BE(i);
      i += 4;
      return v;
    }
    throw new Error('cbor: unsupported length');
  };
  const type = buf[i] >> 5;
  const info = buf[i] & 31;
  i++;
  switch (type) {
    case 0:
      return { value: readLen(info), next: i };
    case 1:
      return { value: -1 - readLen(info), next: i };
    case 2: {
      const len = readLen(info);
      const v = buf.subarray(i, i + len);
      return { value: v, next: i + len };
    }
    case 3: {
      const len = readLen(info);
      const v = buf.subarray(i, i + len).toString('utf8');
      return { value: v, next: i + len };
    }
    case 4: {
      const len = readLen(info);
      const arr = [];
      for (let n = 0; n < len; n++) {
        const item = cborDecode(buf, i);
        arr.push(item.value);
        i = item.next;
      }
      return { value: arr, next: i };
    }
    case 5: {
      const len = readLen(info);
      const map = new Map();
      for (let n = 0; n < len; n++) {
        const k = cborDecode(buf, i);
        const v = cborDecode(buf, k.next);
        map.set(k.value, v.value);
        i = v.next;
      }
      return { value: map, next: i };
    }
    default:
      throw new Error(`cbor: unsupported major type ${type}`);
  }
}

// ------------------------------------------------------- authenticatorData ---

export function parseAuthData(buf) {
  if (buf.length < 37) throw new Error('authData too short');
  const rpIdHash = buf.subarray(0, 32);
  const flags = buf[32];
  const signCount = buf.readUInt32BE(33);
  const out = {
    rpIdHash,
    flags,
    signCount,
    userPresent: !!(flags & 0x01),
    userVerified: !!(flags & 0x04),
    attested: !!(flags & 0x40),
  };
  if (out.attested) {
    // aaguid(16) credIdLen(2) credId(n) coseKey(rest)
    let i = 37 + 16;
    const idLen = buf.readUInt16BE(i);
    i += 2;
    out.credentialId = buf.subarray(i, i + idLen);
    i += idLen;
    out.coseKey = cborDecode(buf, i).value;
  }
  return out;
}

// COSE -> a KeyObject we can verify with. Only the two algorithms browsers
// actually produce: ES256 (P-256) and RS256.
export function coseToKey(cose) {
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2 && alg === -7) {
    const x = cose.get(-2);
    const y = cose.get(-3);
    const jwk = { kty: 'EC', crv: 'P-256', x: b64url(x), y: b64url(y) };
    return { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), alg: -7 };
  }
  if (kty === 3 && alg === -257) {
    const n = cose.get(-1);
    const e = cose.get(-2);
    const jwk = { kty: 'RSA', n: b64url(n), e: b64url(e) };
    return { key: crypto.createPublicKey({ key: jwk, format: 'jwk' }), alg: -257 };
  }
  throw new Error(`unsupported key type ${kty}/${alg}`);
}

function checkClientData(clientDataJSON, expectedType, expectedChallenge) {
  const data = JSON.parse(Buffer.from(clientDataJSON).toString('utf8'));
  if (data.type !== expectedType) throw new Error(`clientData type ${data.type}`);
  // Compared as base64url text, which is how the browser echoes it back.
  if (data.challenge !== expectedChallenge) throw new Error('challenge mismatch');
  if (!rpOrigins().includes(data.origin)) throw new Error(`origin ${data.origin} not allowed`);
  return data;
}

// ----------------------------------------------------------- registration ---

export function verifyRegistration({ attestationObject, clientDataJSON, expectedChallenge }) {
  checkClientData(clientDataJSON, 'webauthn.create', expectedChallenge);
  const att = cborDecode(Buffer.from(attestationObject)).value;
  const authData = parseAuthData(att.get('authData'));
  if (!authData.attested || !authData.credentialId) throw new Error('no credential in authData');
  if (!authData.userPresent) throw new Error('user not present');
  const expectedHash = crypto.createHash('sha256').update(rpId()).digest();
  if (!authData.rpIdHash.equals(expectedHash)) throw new Error('rpId mismatch');
  // `none` attestation is what a platform authenticator sends by default and
  // is all we ask for - the public key is what matters, not its provenance.
  const { key, alg } = coseToKey(authData.coseKey);
  return {
    credentialId: b64url(authData.credentialId),
    publicKey: key.export({ type: 'spki', format: 'pem' }),
    alg,
    signCount: authData.signCount,
  };
}

// -------------------------------------------------------------- assertion ---

export function verifyAssertion({
  authenticatorData,
  clientDataJSON,
  signature,
  expectedChallenge,
  publicKeyPem,
  alg,
  storedSignCount,
}) {
  checkClientData(clientDataJSON, 'webauthn.get', expectedChallenge);
  const authData = Buffer.from(authenticatorData);
  const parsed = parseAuthData(authData);
  if (!parsed.userPresent) throw new Error('user not present');
  const expectedHash = crypto.createHash('sha256').update(rpId()).digest();
  if (!parsed.rpIdHash.equals(expectedHash)) throw new Error('rpId mismatch');

  // The signature covers authenticatorData || SHA256(clientDataJSON).
  const signed = Buffer.concat([authData, crypto.createHash('sha256').update(Buffer.from(clientDataJSON)).digest()]);
  const key = crypto.createPublicKey(publicKeyPem);
  const ok =
    alg === -7
      ? crypto.verify('sha256', signed, { key, dsaEncoding: 'der' }, Buffer.from(signature))
      : crypto.verify('sha256', signed, key, Buffer.from(signature));
  if (!ok) throw new Error('bad signature');

  // A counter that goes backwards suggests a cloned authenticator. Many
  // platform passkeys keep it at 0 forever, so only compare when it moves.
  if (storedSignCount > 0 && parsed.signCount > 0 && parsed.signCount <= storedSignCount) {
    throw new Error('sign count did not advance');
  }
  return { signCount: parsed.signCount };
}

export function registrationOptions({ user, challenge }) {
  return {
    challenge,
    rp: { id: rpId(), name: RP_NAME },
    user: { id: b64url(Buffer.from(user.id)), name: user.phone, displayName: user.name },
    // ES256 first, RS256 as the fallback - between them every browser is covered.
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    timeout: 60000,
    attestation: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  };
}

export function assertionOptions({ challenge, allowCredentials }) {
  return {
    challenge,
    rpId: rpId(),
    timeout: 60000,
    userVerification: 'preferred',
    allowCredentials: allowCredentials.map((id) => ({ type: 'public-key', id })),
  };
}

export const newChallenge = () => b64url(crypto.randomBytes(32));
