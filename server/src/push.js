import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Web Push without dependencies: VAPID (RFC 8292) authentication and
// aes128gcm payload encryption (RFC 8291 / RFC 8188) built on node:crypto.
// Keys are generated once and persisted next to the database.

let vapid = null; // { privateKey: KeyObject, publicRaw: Buffer(65), subject }

export function initPush(dataDir) {
  const file = path.join(dataDir, 'vapid.json');
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  if (!saved || !saved.privPem || !saved.pubJwk) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    saved = {
      privPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      pubJwk: publicKey.export({ format: 'jwk' }),
    };
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(saved), { mode: 0o600 });
  }
  const x = Buffer.from(saved.pubJwk.x, 'base64url');
  const y = Buffer.from(saved.pubJwk.y, 'base64url');
  vapid = {
    privateKey: crypto.createPrivateKey(saved.privPem),
    publicRaw: Buffer.concat([Buffer.from([4]), x, y]),
    subject: process.env.VAPID_SUBJECT || 'mailto:igor_vuta@icloud.com',
  };
}

export function vapidPublicKey() {
  return vapid ? vapid.publicRaw.toString('base64url') : null;
}

function vapidJwt(audience) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const input = `${b64({ typ: 'JWT', alg: 'ES256' })}.${b64({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: vapid.subject,
  })}`;
  const sig = crypto.sign('sha256', Buffer.from(input), { key: vapid.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

// RFC 8291: ECDH(P-256) + HKDF-SHA256 + AES-128-GCM, single aes128gcm record.
export function encryptPayload(p256dhB64, authB64, payload) {
  const uaPub = Buffer.from(p256dhB64, 'base64url');
  const authSecret = Buffer.from(authB64, 'base64url');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPub);
  const prk = Buffer.from(
    crypto.hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32)
  );
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const plaintext = Buffer.concat([Buffer.from(payload), Buffer.from([2])]); // 0x02 = last record delimiter
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.concat([salt, Buffer.from([0, 0, 16, 0]) /* rs=4096 */, Buffer.from([asPub.length]), asPub]);
  return Buffer.concat([header, ct]);
}

export async function sendWebPush(sub, payloadObj) {
  if (!vapid || !sub || !sub.endpoint || !sub.keys) return 0;
  const body = encryptPayload(sub.keys.p256dh, sub.keys.auth, JSON.stringify(payloadObj));
  const aud = new URL(sub.endpoint).origin;
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: '300',
      Urgency: 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: `vapid t=${vapidJwt(aud)}, k=${vapidPublicKey()}`,
    },
    body,
  });
  return res.status;
}

// Fire-and-forget to every subscription a user has; dead ones are pruned.
export function pushToUser(store, userId, payload) {
  if (!vapid || !userId) return;
  let subs = [];
  try {
    subs = store.pushSubsFor(userId);
  } catch {
    return;
  }
  for (const s of subs) {
    sendWebPush(s, payload)
      .then((status) => {
        if (status === 404 || status === 410) store.dropPushSub(s.endpoint);
      })
      .catch(() => {});
  }
}
