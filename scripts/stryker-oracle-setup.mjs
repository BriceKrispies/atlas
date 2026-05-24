/**
 * Stryker oracle setup — wires identity Crypto on the SANDBOX module
 * instance.
 *
 * The default `test-setup/identity-crypto.ts` imports `@atlas/identity`
 * by package name, which resolves via the sandbox's `node_modules`
 * symlink back to the REAL `modules/identity` location. Tests in the
 * sandbox import `'../src/index.ts'`, which resolves to the SANDBOX
 * COPY at `.stryker-tmp/.../modules/identity/src/index.ts`. Under ESM,
 * different URLs are different module instances — `setIdentityCrypto`
 * on one is invisible to the other, so the tests fail with "identity
 * Crypto not configured."
 *
 * This setup file imports `modules/identity/src/index.ts` via a
 * cwd-relative dynamic import, matching the sandbox-relative path the
 * tests use. Same URL ⇒ same module instance ⇒ `setIdentityCrypto`
 * lands where the tests can see it.
 *
 * Used by `scripts/stryker-oracle-command.mjs` for the oracle config.
 * Not used by the normal `pnpm test` flow.
 *
 * Spec: `C:\Users\Brice\.claude\plans\twinkly-popping-deer.md`
 * Stryker Node-Test Runner Plugin plan, Phase 1.
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
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Resolve the identity module via the SANDBOX path. `process.cwd()` is
// the sandbox root (Stryker spawns the command runner from there).
const identityIndexUrl = pathToFileURL(
  resolve(process.cwd(), 'modules/identity/src/index.ts'),
).href;
const { setIdentityCrypto } = await import(identityIndexUrl);

function toPlain(buf) {
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
    return toPlain(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]),
    );
  },
  scrypt: (password, salt, dkLen, params) =>
    toPlain(scryptSync(password, salt, dkLen, params)),
  timingSafeEqual: (a, b) =>
    a.length === b.length && nodeTimingSafeEqual(a, b),
});
