import type { Crypto } from '@atlas/ports';

/**
 * Browser `Crypto` adapter — partial impl. Per ADR 0008 §5 the IDB
 * adapter is scoped to tenant-app data, NOT to identity / TOTP /
 * password flows. Methods that have no sync browser equivalent
 * (`sha256`, `hmacSha1`, `aesGcm*`, `scrypt`) throw with a clear
 * message. `randomBytes` and `timingSafeEqual` are sync-implementable
 * via WebCrypto and are provided.
 *
 * Promote any throwing method to a real impl when a tenant-app-data
 * use case arises.
 */
export class WebCrypto implements Crypto {
  randomBytes(n: number): Uint8Array {
    const buf = new Uint8Array(n);
    globalThis.crypto.getRandomValues(buf);
    return buf;
  }

  sha256(_input: Uint8Array | string): Uint8Array {
    throw new Error(
      'WebCrypto.sha256 not implemented — IDB runtime is tenant-app-data scoped (ADR 0008 §5)',
    );
  }

  hmacSha1(_key: Uint8Array, _message: Uint8Array): Uint8Array {
    throw new Error(
      'WebCrypto.hmacSha1 not implemented — IDB runtime is tenant-app-data scoped (ADR 0008 §5)',
    );
  }

  aesGcmEncrypt(): { ciphertext: Uint8Array; tag: Uint8Array } {
    throw new Error(
      'WebCrypto.aesGcmEncrypt not implemented — IDB runtime is tenant-app-data scoped (ADR 0008 §5)',
    );
  }

  aesGcmDecrypt(): Uint8Array {
    throw new Error(
      'WebCrypto.aesGcmDecrypt not implemented — IDB runtime is tenant-app-data scoped (ADR 0008 §5)',
    );
  }

  scrypt(): Uint8Array {
    throw new Error(
      'WebCrypto.scrypt not implemented — IDB runtime is tenant-app-data scoped (ADR 0008 §5)',
    );
  }

  timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
    return diff === 0;
  }
}
