/**
 * IdP metadata parser (Phase A6.4).
 *
 * Takes the IdP-published metadata XML (entity descriptor) and
 * extracts entityID, single-sign-on URL, signing certificate. The
 * extracted shape maps cleanly to `Identity.IdentityProvider.Configure`
 * for `kind=saml`.
 *
 * Lenient on whitespace / XML namespace prefixes (real IdP exports
 * use varied conventions). Strict on missing required elements —
 * better to refuse a malformed IdP config than to land a partial one
 * that fails on first use.
 */

import { XMLParser } from 'fast-xml-parser';
import { IdentityError, codes } from '../errors.ts';
import type {
  SamlAttributeMappings,
  SamlNameIdFormat,
} from '../types.ts';

export interface ParsedIdpMetadata {
  /** SAML entityID. */
  entityId: string;
  /** Preferred SSO URL (HTTP-POST binding when available, else Redirect). */
  ssoUrl: string;
  /** Optional SLO URL. */
  sloUrl?: string;
  /** PEM-encoded signing cert (extracted from <KeyDescriptor use="signing">). */
  signingCertPem: string;
  /** First NameIDFormat declared (or `unspecified`). */
  nameIdFormat: SamlNameIdFormat;
}

const PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

const POST_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
const REDIRECT_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';

const NAMEID_FORMAT_MAP: Record<string, SamlNameIdFormat> = {
  'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress': 'emailAddress',
  'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent': 'persistent',
  'urn:oasis:names:tc:SAML:2.0:nameid-format:transient': 'transient',
  'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified': 'unspecified',
};

function arr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function pemFromBase64Cert(b64: string): string {
  // Normalize whitespace + wrap to 64-char lines.
  const compact = b64.replace(/\s+/g, '');
  const lines: string[] = [];
  for (let i = 0; i < compact.length; i += 64) {
    lines.push(compact.slice(i, i + 64));
  }
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

export function parseIdpMetadata(xml: string): ParsedIdpMetadata {
  let parsed: Record<string, unknown>;
  try {
    parsed = PARSER.parse(xml) as Record<string, unknown>;
  } catch (e) {
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      `metadata XML parse failed: ${(e as Error).message}`,
      400,
    );
  }
  const ed = (parsed['EntityDescriptor'] ?? parsed['EntitiesDescriptor']) as
    | Record<string, unknown>
    | undefined;
  if (!ed) {
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      'EntityDescriptor element missing',
      400,
    );
  }
  const entityId =
    (ed['@_entityID'] as string | undefined) ?? (ed['@_entityId'] as string | undefined);
  if (!entityId) {
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      'EntityDescriptor@entityID missing',
      400,
    );
  }
  const idpSsoDescriptor = ed['IDPSSODescriptor'] as
    | Record<string, unknown>
    | undefined;
  if (!idpSsoDescriptor) {
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      'IDPSSODescriptor missing — only IdP metadata is supported here',
      400,
    );
  }
  // ----- SSO URL: prefer POST binding, fall back to Redirect -------
  const ssoServices = arr(
    idpSsoDescriptor['SingleSignOnService'] as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined,
  );
  const post = ssoServices.find((s) => s['@_Binding'] === POST_BINDING);
  const redirect = ssoServices.find((s) => s['@_Binding'] === REDIRECT_BINDING);
  const chosen = post ?? redirect ?? ssoServices[0];
  if (!chosen || !chosen['@_Location']) {
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      'no SingleSignOnService/@Location in metadata',
      400,
    );
  }
  const ssoUrl = chosen['@_Location'] as string;

  const sloServices = arr(
    idpSsoDescriptor['SingleLogoutService'] as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined,
  );
  const sloUrl =
    (sloServices[0]?.['@_Location'] as string | undefined) ?? undefined;

  // ----- Signing cert: KeyDescriptor where use="signing" (or use omitted) ---
  const keyDescriptors = arr(
    idpSsoDescriptor['KeyDescriptor'] as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined,
  );
  const signingKD =
    keyDescriptors.find((k) => k['@_use'] === 'signing') ??
    keyDescriptors.find((k) => k['@_use'] === undefined) ??
    keyDescriptors[0];
  if (!signingKD) {
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      'no KeyDescriptor in metadata',
      400,
    );
  }
  const keyInfo = signingKD['KeyInfo'] as Record<string, unknown> | undefined;
  const x509Data = keyInfo?.['X509Data'] as Record<string, unknown> | undefined;
  const x509Cert = x509Data?.['X509Certificate'] as string | undefined;
  if (!x509Cert) {
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      'no X509Certificate in KeyInfo',
      400,
    );
  }
  const signingCertPem = pemFromBase64Cert(x509Cert);

  // ----- NameID format ---------------------------------------------
  const nameIds = arr(
    idpSsoDescriptor['NameIDFormat'] as string | string[] | undefined,
  );
  const matchedNid = nameIds
    .map((n) => NAMEID_FORMAT_MAP[n])
    .filter((v): v is SamlNameIdFormat => v !== undefined)[0] ?? 'unspecified';

  return {
    entityId,
    ssoUrl,
    ...(sloUrl !== undefined ? { sloUrl } : {}),
    signingCertPem,
    nameIdFormat: matchedNid,
  };
}

/**
 * Default attribute mappings — most IdPs use these standard attribute
 * names. Tenants override per-IdP via `IdentityProvider.samlAttributeMappings`.
 */
export const DEFAULT_SAML_ATTRIBUTE_MAPPINGS: SamlAttributeMappings = {
  email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  givenName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
  familyName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
  groups: 'http://schemas.xmlsoap.org/claims/Group',
};
