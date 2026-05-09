/**
 * Vitest setup — wire identity's Crypto resolver eagerly so any test
 * that calls into the identity module gets a working crypto without
 * having to import a fixture helper. Mirrors the NodeCrypto adapter
 * shape (we don't depend on @atlas/adapter-node directly because
 * setup files load before module aliasing — and to avoid cycles).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
  scryptSync,
  timingSafeEqual as nodeTimingSafeEqual,
} from 'node:crypto';
import { setIdentityCrypto } from '@atlas/identity';

function toPlain(buf: Buffer): Uint8Array {
  const out = new Uint8Array(buf.length);
  out.set(buf);
  return out;
}

setIdentityCrypto({
  randomBytes: (n) => toPlain(nodeRandomBytes(n)),
  sha256: (input) => {
    const data = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
    return toPlain(createHash('sha256').update(data).digest());
  },
  hmacSha1: (key, msg) => toPlain(createHmac('sha1', key).update(msg).digest()),
  aesGcmEncrypt: (key, iv, plaintext) => {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { ciphertext: toPlain(ct), tag: toPlain(cipher.getAuthTag()) };
  },
  aesGcmDecrypt: (key, iv, ciphertext, tag) => {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return toPlain(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  },
  scrypt: (password, salt, dkLen, params) =>
    toPlain(scryptSync(password, salt, dkLen, params)),
  timingSafeEqual: (a, b) => a.length === b.length && nodeTimingSafeEqual(a, b),
});
