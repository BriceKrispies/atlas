/**
 * `SamlAssertionReplay` entity — replay-protection record for SAML
 * assertions.
 *
 * Persisted on FIRST sight of an assertion id (in the verify path);
 * lookup-on-verify rejects duplicates within the assertion's window.
 * After `expiresAt` the row is reapable — duplicates older than the
 * lifetime can't replay anyway because the IdP would refuse to
 * re-issue the same id beyond its `NotOnOrAfter`.
 *
 * The cleanup worker (post-A6 follow-up — same shape as the audit
 * export worker) deletes expired rows on a periodic cron.
 */

import type { EntityStore } from '@atlas/ports';
import type { SamlAssertionReplayDocument } from '../types.ts';
import { newSamlReplayRecordId } from '../ids.ts';

export const SAML_ASSERTION_REPLAY_ENTITY_TYPE = 'SamlAssertionReplay';
export const SAML_ASSERTION_REPLAY_LATEST_VERSION = 1;

export async function recordSeenAssertion(
  store: EntityStore,
  tenantId: string,
  idpId: string,
  assertionId: string,
  expiresAt: string,
): Promise<{ alreadySeen: boolean; record: SamlAssertionReplayDocument }> {
  const recordId = newSamlReplayRecordId(assertionId);
  const existing = await store.get<SamlAssertionReplayDocument>(
    tenantId,
    SAML_ASSERTION_REPLAY_ENTITY_TYPE,
    recordId,
  );
  if (existing && existing.status !== 'deleted') {
    return { alreadySeen: true, record: existing.attrs };
  }
  const record: SamlAssertionReplayDocument = {
    recordId,
    tenantId,
    idpId,
    assertionId,
    expiresAt,
    recordedAt: new Date().toISOString(),
  };
  await store.put<SamlAssertionReplayDocument>({
    tenantId,
    entityType: SAML_ASSERTION_REPLAY_ENTITY_TYPE,
    entityId: recordId,
    attrs: record,
    schemaVersion: SAML_ASSERTION_REPLAY_LATEST_VERSION,
  });
  return { alreadySeen: false, record };
}
