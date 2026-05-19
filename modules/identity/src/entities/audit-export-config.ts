/**
 * `AuditExportConfig` + `AuditExportRun` entity wrappers (Phase A4.8).
 *
 * One AuditExportConfig per tenant — a singleton that the worker
 * polls. Each AuditExportRun records one drain pass (success or
 * failure). The cursor (event-store seq) advances on success; on
 * failure the next run picks up from the previous cursor.
 */
import type { EntityStore } from '@atlas/ports';
import type { AuditExportConfigDocument, AuditExportRunDocument, } from '../types.ts';
export const AUDIT_EXPORT_CONFIG_ENTITY_TYPE = 'AuditExportConfig';
export const AUDIT_EXPORT_CONFIG_LATEST_VERSION = 1;
export const AUDIT_EXPORT_RUN_ENTITY_TYPE = 'AuditExportRun';
export const AUDIT_EXPORT_RUN_LATEST_VERSION = 1;
export async function getAuditExportConfig(store: EntityStore, tenantId: string, configId: string): Promise<AuditExportConfigDocument | null> {
    const row = await store.get<AuditExportConfigDocument>(tenantId, AUDIT_EXPORT_CONFIG_ENTITY_TYPE, configId);
    if (!row || row.status === 'deleted')
        return null;
    return row.attrs;
}
export async function putAuditExportConfig(store: EntityStore, doc: AuditExportConfigDocument): Promise<void> {
    await store.put<AuditExportConfigDocument>({
        tenantId: doc.tenantId,
        entityType: AUDIT_EXPORT_CONFIG_ENTITY_TYPE,
        entityId: doc.configId,
        attrs: doc,
        schemaVersion: AUDIT_EXPORT_CONFIG_LATEST_VERSION,
    });
}
export async function listAuditExportConfigs(store: EntityStore, tenantId: string): Promise<AuditExportConfigDocument[]> {
    const rows = await store.list<AuditExportConfigDocument>(tenantId, AUDIT_EXPORT_CONFIG_ENTITY_TYPE);
    return rows.map(function (r) {
        return r.attrs;
    });
}
export async function putAuditExportRun(store: EntityStore, doc: AuditExportRunDocument): Promise<void> {
    await store.put<AuditExportRunDocument>({
        tenantId: doc.tenantId,
        entityType: AUDIT_EXPORT_RUN_ENTITY_TYPE,
        entityId: doc.runId,
        attrs: doc,
        schemaVersion: AUDIT_EXPORT_RUN_LATEST_VERSION,
    });
}
export async function listAuditExportRuns(store: EntityStore, tenantId: string): Promise<AuditExportRunDocument[]> {
    const rows = await store.list<AuditExportRunDocument>(tenantId, AUDIT_EXPORT_RUN_ENTITY_TYPE);
    return rows.map(function (r) {
        return r.attrs;
    });
}
