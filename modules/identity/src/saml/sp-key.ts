/**
 * SAML SP key generation — RSA-2048 + self-signed X.509.
 *
 * `node-forge` handles both the RSA key gen and the cert chain. The
 * cert is self-signed because SAML doesn't require a CA chain — the
 * IdP pins the public cert via metadata. `commonName` defaults to the
 * tenant's SP entity id.
 *
 * Output:
 *   - `privateKeyPem`: PKCS#8 PEM. Encrypted at rest via the same
 *     per-tenant key derivation TOTP uses.
 *   - `publicCertPem`: self-signed X.509 PEM. Goes into SP metadata.
 */

// `import * as forge` only attaches `.default` under Node ESM (node-forge is
// CJS). The runtime shape we actually want is the default export, so import
// it explicitly — keeps the call sites (`forge.pki.rsa.generateKeyPair`,
// `forge.pki.createCertificate`) unchanged.
import forge from 'node-forge';

export interface GeneratedSpKey {
  privateKeyPem: string;
  publicCertPem: string;
  keyLength: number;
  notBefore: string;
  notAfter: string;
}

export interface GenerateSpKeyOptions {
  /** Subject CN — typically the SP entityId. */
  commonName: string;
  /** Validity in days. Default 730 (2 years). */
  validDays?: number;
  /** RSA modulus length. Default 2048; 4096 for paranoid tenants. */
  keyLength?: 2048 | 3072 | 4096;
}

export function generateSamlSpKey(opts: GenerateSpKeyOptions): GeneratedSpKey {
  const keyLength = opts.keyLength ?? 2048;
  const validDays = opts.validDays ?? 730;
  const keys = forge.pki.rsa.generateKeyPair({ bits: keyLength, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = `01${Math.floor(Math.random() * 1e15).toString(16)}`;
  const notBefore = new Date();
  const notAfter = new Date(notBefore.getTime() + validDays * 24 * 60 * 60 * 1000);
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;
  const attrs = [
    { name: 'commonName', value: opts.commonName },
    { name: 'organizationName', value: 'Atlas' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: false,
      dataEncipherment: false,
      keyCertSign: false,
      cRLSign: false,
    },
    { name: 'extKeyUsage', clientAuth: true, codeSigning: false },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    publicCertPem: forge.pki.certificateToPem(cert),
    keyLength,
    notBefore: notBefore.toISOString(),
    notAfter: notAfter.toISOString(),
  };
}
