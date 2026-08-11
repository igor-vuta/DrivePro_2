import crypto from 'node:crypto';

// A WebAuthn authenticator in software: holds a real P-256 key, assembles
// genuine authenticatorData / clientDataJSON / attestationObject structures
// and signs them exactly as a platform authenticator would. Shared by every
// suite that needs to register or assert a passkey without a browser.

export const b64url = (b) => Buffer.from(b).toString('base64url');

function cborBytes(buf) {
  // byte string, major type 2
  if (buf.length < 24) return Buffer.concat([Buffer.from([0x40 | buf.length]), buf]);
  if (buf.length < 256) return Buffer.concat([Buffer.from([0x58, buf.length]), buf]);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(buf.length);
  return Buffer.concat([Buffer.from([0x59]), len, buf]);
}
function cborText(str) {
  const b = Buffer.from(str, 'utf8');
  return Buffer.concat([Buffer.from([0x60 | b.length]), b]);
}
function cborMap(pairs) {
  return Buffer.concat([Buffer.from([0xa0 | pairs.length]), ...pairs.flat()]);
}

export class VirtualAuthenticator {
  constructor(rpId, defaultOrigin) {
    this.rpId = rpId;
    this.defaultOrigin = defaultOrigin || `https://${rpId}`;
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.credentialId = crypto.randomBytes(32);
    this.signCount = 0;
  }

  authData({ attested }) {
    const rpIdHash = crypto.createHash('sha256').update(this.rpId).digest();
    // UP | UV, plus AT when a credential is attached.
    const flags = Buffer.from([attested ? 0x45 : 0x05]);
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.signCount);
    if (!attested) return Buffer.concat([rpIdHash, flags, count]);

    const jwk = this.publicKey.export({ format: 'jwk' });
    // COSE_Key: {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}
    const cose = cborMap([
      [Buffer.from([0x01]), Buffer.from([0x02])],
      [Buffer.from([0x03]), Buffer.from([0x26])], // -7
      [Buffer.from([0x20]), Buffer.from([0x01])], // -1 : 1
      [Buffer.from([0x21]), cborBytes(Buffer.from(jwk.x, 'base64url'))], // -2
      [Buffer.from([0x22]), cborBytes(Buffer.from(jwk.y, 'base64url'))], // -3
    ]);
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    return Buffer.concat([rpIdHash, flags, count, Buffer.alloc(16), idLen, this.credentialId, cose]);
  }

  clientData(type, challenge, origin = this.defaultOrigin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');
  }

  register(challenge, origin) {
    const authData = this.authData({ attested: true });
    const attestationObject = cborMap([
      [cborText('fmt'), cborText('none')],
      [cborText('attStmt'), Buffer.from([0xa0])],
      [cborText('authData'), cborBytes(authData)],
    ]);
    return {
      challenge,
      attestationObject: b64url(attestationObject),
      clientDataJSON: b64url(this.clientData('webauthn.create', challenge, origin)),
    };
  }

  assert(challenge, { origin, bumpCount = true, tamper = false } = {}) {
    if (bumpCount) this.signCount += 1;
    const authData = this.authData({ attested: false });
    const clientDataJSON = this.clientData('webauthn.get', challenge, origin);
    const signed = Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]);
    const signature = crypto.sign('sha256', signed, { key: this.privateKey, dsaEncoding: 'der' });
    if (tamper) signature[signature.length - 1] ^= 0xff;
    return {
      challenge,
      credentialId: b64url(this.credentialId),
      authenticatorData: b64url(authData),
      clientDataJSON: b64url(clientDataJSON),
      signature: b64url(signature),
    };
  }
}
