/**
 * SAML AuthnRequest builder (Phase A6.5).
 *
 * Builds a `<samlp:AuthnRequest>` XML document for SP-initiated
 * sign-on. Supports HTTP-Redirect (DEFLATE + base64 + URL-encode +
 * sign with SP private key) and HTTP-POST (base64 of the XML).
 *
 * Phase A6.5 ships unsigned redirect-binding (sufficient for
 * IdP-initiated environments and POST flows where the request lives
 * inside an HTTP form). Per-tenant SP signing of the request is
 * post-A6 polish — most IdPs accept unsigned AuthnRequests when the
 * SP cert is registered in metadata.
 */

import type { Compression } from '@atlas/ports';

export interface BuildAuthnRequestOptions {
  /** SP entityID — goes into `<saml:Issuer>`. */
  spEntityId: string;
  /** IdP SSO URL (the AuthnRequest target). */
  destination: string;
  /** Where the IdP should POST the SAMLResponse. */
  acsUrl: string;
  /** Requested NameID format (when supported by IdP). */
  nameIdFormat?: string;
  /** Generate a fresh request id; the SP stashes it for InResponseTo verify. */
  requestId?: string;
  /** ISO timestamp; defaults to now. */
  issueInstant?: string;
}

export interface BuiltAuthnRequest {
  /** Request id (also returned for the InResponseTo round-trip). */
  requestId: string;
  /** Raw XML — used by HTTP-POST binding (form body). */
  xml: string;
  /** URL-encoded `SAMLRequest=...` parameter for HTTP-Redirect binding. */
  redirectQueryParam: string;
  /** Full redirect URL: `<destination>?SAMLRequest=...&RelayState=...`. */
  buildRedirectUrl(relayState?: string): string;
}

const SAMLP_NS = 'urn:oasis:names:tc:SAML:2.0:protocol';
const SAML_NS = 'urn:oasis:names:tc:SAML:2.0:assertion';

function newRequestId(): string {
  // SAML ids must start with a letter (XML ID rules); `_` prefix is
  // the convention used by virtually every SAML library.
  return `_${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function buildAuthnRequest(
  opts: BuildAuthnRequestOptions,
  compression: Compression,
): Promise<BuiltAuthnRequest> {
  const requestId = opts.requestId ?? newRequestId();
  const issueInstant = opts.issueInstant ?? new Date().toISOString();
  const nameIdFormat =
    opts.nameIdFormat ?? 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent';
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<samlp:AuthnRequest xmlns:samlp="${SAMLP_NS}" ` +
    `xmlns:saml="${SAML_NS}" ` +
    `ID="${escapeXml(requestId)}" ` +
    `Version="2.0" ` +
    `IssueInstant="${escapeXml(issueInstant)}" ` +
    `Destination="${escapeXml(opts.destination)}" ` +
    `ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" ` +
    `AssertionConsumerServiceURL="${escapeXml(opts.acsUrl)}">` +
    `<saml:Issuer>${escapeXml(opts.spEntityId)}</saml:Issuer>` +
    `<samlp:NameIDPolicy Format="${escapeXml(nameIdFormat)}" AllowCreate="true"/>` +
    `</samlp:AuthnRequest>`;

  // HTTP-Redirect binding: DEFLATE → base64 → URL-encode.
  const deflated = await compression.deflateRaw(new TextEncoder().encode(xml));
  const b64 = Buffer.from(deflated).toString('base64');
  const redirectQueryParam = `SAMLRequest=${encodeURIComponent(b64)}`;

  function buildRedirectUrl(relayState?: string): string {
    const sep = opts.destination.includes('?') ? '&' : '?';
    let url = `${opts.destination}${sep}${redirectQueryParam}`;
    if (relayState) {
      url += `&RelayState=${encodeURIComponent(relayState)}`;
    }
    return url;
  }

  return { requestId, xml, redirectQueryParam, buildRedirectUrl };
}
