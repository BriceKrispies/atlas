/**
 * `RecoveryCode` entity — typed wrappers around `EntityStore`.
 *
 * One row per code (10 per regen by default). Codes share a `batchId`
 * so Regenerate can flip an entire batch to `'invalidated'` in one
 * pass. Hashed at rest (Argon2id).
 */

import type { EntityStore } from '@atlas/ports';
import type { RecoveryCodeDocument } from '../types.ts';

export const RECOVERY_CODE_ENTITY_TYPE = 'RecoveryCode';
export const RECOVERY_CODE_LATEST_VERSION = 1;

export async function getRecoveryCodeEntity(
  store: EntityStore,
  tenantId: string,
  codeId: string,
): Promise<RecoveryCodeDocument | null> {
  const row = await store.get<RecoveryCodeDocument>(
    tenantId,
    RECOVERY_CODE_ENTITY_TYPE,
    codeId,
  );
  if (!row || row.status === 'deleted') return null;
  return row.attrs;
}

export async function putRecoveryCodeEntity(
  store: EntityStore,
  doc: RecoveryCodeDocument,
): Promise<void> {
  await store.put<RecoveryCodeDocument>({
    tenantId: doc.tenantId,
    entityType: RECOVERY_CODE_ENTITY_TYPE,
    entityId: doc.codeId,
    attrs: doc,
    schemaVersion: RECOVERY_CODE_LATEST_VERSION,
  });
}

export async function listRecoveryCodesForUser(
  store: EntityStore,
  tenantId: string,
  userId: string,
): Promise<RecoveryCodeDocument[]> {
  const rows = await store.query<RecoveryCodeDocument>(
    tenantId,
    RECOVERY_CODE_ENTITY_TYPE,
    { attrsEqual: { userId } },
  );
  return rows.map((r) => r.attrs);
}

export async function findRecoveryCodesByLookup(
  store: EntityStore,
  tenantId: string,
  userId: string,
  codeLookup: string,
): Promise<RecoveryCodeDocument[]> {
  const rows = await store.query<RecoveryCodeDocument>(
    tenantId,
    RECOVERY_CODE_ENTITY_TYPE,
    { attrsEqual: { userId, codeLookup } },
  );
  return rows.map((r) => r.attrs);
}
