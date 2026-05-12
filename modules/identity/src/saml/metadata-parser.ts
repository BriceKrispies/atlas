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
import {
  asXmlRecord,
  asXmlRecordArray,
  asXmlString,
  asXmlStringOrArray,
} from './xml-narrow.ts';

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
  let parsedRoot: Record<string, unknown> | undefined;
  try {
    parsedRoot = asXmlRecord(PARSER.parse(xml));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      `metadata XML parse failed: ${message}`,
      400,
    );
  }
  if (!parsedRoot) {
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      'metadata XML did not parse to a document element',
      400,
    );
  }
  const ed =
    asXmlRecord(parsedRoot['EntityDescriptor']) ??
    asXmlRecord(parsedRoot['EntitiesDescriptor']);
  if (!ed) {
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      'EntityDescriptor element missing',
      400,
    );
  }
  const entityId =
    asXmlString(ed['@_entityID']) ?? asXmlString(ed['@_entityId']);
  if (!entityId) {
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      'EntityDescriptor@entityID missing',
      400,
    );
  }
  const idpSsoDescriptor = asXmlRecord(ed['IDPSSODescriptor']);
  if (!idpSsoDescriptor) {
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      'IDPSSODescriptor missing — only IdP metadata is supported here',
      400,
    );
  }
  // ----- SSO URL: prefer POST binding, fall back to Redirect -------
  const ssoServices = asXmlRecordArray(idpSsoDescriptor['SingleSignOnService']);
  const post = ssoServices.find((s) => asXmlString(s['@_Binding']) === POST_BINDING);
  const redirect = ssoServices.find(
    (s) => asXmlString(s['@_Binding']) === REDIRECT_BINDING,
  );
  const chosen = post ?? redirect ?? ssoServices[0];
  const chosenLocation = chosen ? asXmlString(chosen['@_Location']) : undefined;
  if (!chosen || !chosenLocation) {
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      'no SingleSignOnService/@Location in metadata',
      400,
    );
  }
  const ssoUrl = chosenLocation;

  const sloServices = asXmlRecordArray(idpSsoDescriptor['SingleLogoutService']);
  const sloUrl = sloServices[0]
    ? asXmlString(sloServices[0]['@_Location'])
    : undefined;

  // ----- Signing cert: KeyDescriptor where use="signing" (or use omitted) ---
  const keyDescriptors = asXmlRecordArray(idpSsoDescriptor['KeyDescriptor']);
  const signingKD =
    keyDescriptors.find((k) => asXmlString(k['@_use']) === 'signing') ??
    keyDescriptors.find((k) => asXmlString(k['@_use']) === undefined) ??
    keyDescriptors[0];
  if (!signingKD) {
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      'no KeyDescriptor in metadata',
      400,
    );
  }
  const keyInfo = asXmlRecord(signingKD['KeyInfo']);
  const x509Data = asXmlRecord(keyInfo?.['X509Data']);
  const x509Cert = asXmlString(x509Data?.['X509Certificate']);
  if (!x509Cert) {
    throw new IdentityError(
      codes.SAML_INVALID_METADATA,
      'no X509Certificate in KeyInfo',
      400,
    );
  }
  const signingCertPem = pemFromBase64Cert(x509Cert);

  // ----- NameID format ---------------------------------------------
  const nameIdsRaw = asXmlStringOrArray(idpSsoDescriptor['NameIDFormat']) ?? [];
  const nameIds = Array.isArray(nameIdsRaw) ? nameIdsRaw : [nameIdsRaw];
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
