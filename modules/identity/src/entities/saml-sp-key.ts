/**
 * `SamlSpKey` entity — per-tenant SP signing key for SAML.
 *
 * The SP signs AuthnRequests with the private key; the IdP fetches
 * the public cert from `/sso/saml/<tenantId>/metadata.xml`. Rotation
 * mints a successor + leaves the predecessor valid for an overlap
 * window so IdPs can re-fetch metadata without breaking in-flight
 * ceremonies.
 */
import type { EntityStore } from '@atlas/ports';
import type { SamlSpKeyDocument, SamlSpKeyStatus } from '../types.ts';
export const SAML_SP_KEY_ENTITY_TYPE = 'SamlSpKey';
export const SAML_SP_KEY_LATEST_VERSION = 1;
export async function getSamlSpKeyEntity(store: EntityStore, tenantId: string, keyId: string): Promise<SamlSpKeyDocument | null> {
    const row = await store.get<SamlSpKeyDocument>(tenantId, SAML_SP_KEY_ENTITY_TYPE, keyId);
    if (!row || row.status === 'deleted')
        return null;
    return row.attrs;
}
export async function putSamlSpKeyEntity(store: EntityStore, doc: SamlSpKeyDocument): Promise<void> {
    await store.put<SamlSpKeyDocument>({
        tenantId: doc.tenantId,
        entityType: SAML_SP_KEY_ENTITY_TYPE,
        entityId: doc.keyId,
        attrs: doc,
        schemaVersion: SAML_SP_KEY_LATEST_VERSION,
    });
}
/**
 * Highest-priority active SP key for a tenant. AuthnRequest signing
 * uses this. Metadata exposes BOTH active and rotated-but-overlapping
 * keys so the IdP can verify in-flight assertions during cutover.
 */
export async function findActiveSamlSpKey(store: EntityStore, tenantId: string): Promise<SamlSpKeyDocument | null> {
    const rows = await store.query<SamlSpKeyDocument>(tenantId, SAML_SP_KEY_ENTITY_TYPE, { attrsEqual: { status: 'active' satisfies SamlSpKeyStatus } });
    if (rows.length === 0)
        return null;
    // Prefer the most recently issued.
    return rows
        .map(function (r) {
        return r.attrs;
    })
        .sort(function (a, b) {
        return (a.issuedAt < b.issuedAt ? 1 : -1);
    })[0] ?? null;
}
/**
 * All keys to expose in metadata (active + rotated still inside
 * overlap). The IdP MAY use any of them to verify a signature.
 */
export async function listMetadataSamlSpKeys(store: EntityStore, tenantId: string): Promise<SamlSpKeyDocument[]> {
    const rows = await store.list<SamlSpKeyDocument>(tenantId, SAML_SP_KEY_ENTITY_TYPE);
    const now = Date.now();
    return rows
        .map(function (r) {
        return r.attrs;
    })
        .filter(function (k) {
        if (k.status === 'active')
            return true;
        if (k.status === 'rotated' &&
            k.rotationOverlapUntil &&
            new Date(k.rotationOverlapUntil).getTime() > now) {
            return true;
        }
        return false;
    });
}
