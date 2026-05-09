import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
  scryptSync,
  timingSafeEqual as nodeTimingSafeEqual,
} from 'node:crypto';
import type { Crypto } from '@atlas/ports';

/**
 * Node `Crypto` adapter — wraps `node:crypto`'s sync API and converts
 * `Buffer` outputs to plain `Uint8Array` so contract assertions are
 * interchangeable across adapters (matches the NodeCompression
 * convention from slice 1.4).
 */
export class NodeCrypto implements Crypto {
  randomBytes(n: number): Uint8Array {
    return toPlain(nodeRandomBytes(n));
  }

  sha256(input: Uint8Array | string): Uint8Array {
    const data = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
    return toPlain(createHash('sha256').update(data).digest());
  }

  hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
    return toPlain(createHmac('sha1', key).update(message).digest());
  }

  aesGcmEncrypt(
    key: Uint8Array,
    iv: Uint8Array,
    plaintext: Uint8Array,
  ): { ciphertext: Uint8Array; tag: Uint8Array } {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { ciphertext: toPlain(ct), tag: toPlain(cipher.getAuthTag()) };
  }

  aesGcmDecrypt(
    key: Uint8Array,
    iv: Uint8Array,
    ciphertext: Uint8Array,
    tag: Uint8Array,
  ): Uint8Array {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return toPlain(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
  }

  scrypt(
    password: string,
    salt: Uint8Array,
    dkLen: number,
    params: { N: number; r: number; p: number },
  ): Uint8Array {
    return toPlain(scryptSync(password, salt, dkLen, params));
  }

  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    return nodeTimingSafeEqual(a, b);
  }
}

function toPlain(buf: Buffer): Uint8Array {
  const out = new Uint8Array(buf.length);
  out.set(buf);
  return out;
}
