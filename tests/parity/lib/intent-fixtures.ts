/**
 * Intent fixtures used by the auth / authz / idempotency / intent-submission
 * parity scenarios. These mirror `tests/blackbox/harness/fixtures.rs` but
 * target catalog actions (`Catalog.SeedPackage.Apply`) — content-pages doesn't
 * exist in TS yet (see Chunk 7).
 */

import type { IntentEnvelope } from '@atlas/platform-core';
import { newEventId } from '@atlas/catalog';
import { loadBadgeFamilySeed } from './fixtures.ts';

export interface BuildIntentOpts {
  tenantId: string;
  principalId: string;
  idempotencyKey: string;
  /**
   * Override fields after the base envelope is built. `payload` is a partial
   * patch merged on top of the seed-apply payload — the merge keeps the
   * required `actionId` and `resourceType` from the base envelope so the
   * helper still produces a schema-valid intent unless callers explicitly
   * overwrite those keys.
   */
  overrides?: Partial<Omit<IntentEnvelope, 'payload'>> & {
    payload?: Record<string, unknown>;
  };
}

export function uniqueIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * A valid catalog seed-apply intent. This is the TS analogue of the Rust
 * `valid_intent_payload()` helper — the Rust suite uses page.create, the TS
 * server only knows about catalog actions.
 */
export function validIntent(opts: BuildIntentOpts): IntentEnvelope {
  const seed = loadBadgeFamilySeed();
  const base: IntentEnvelope = {
    eventId: newEventId(),
    eventType: 'Catalog.SeedPackage.ApplyRequested',
    schemaId: 'catalog.seed_package.apply.v1',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    tenantId: opts.tenantId,
    correlationId: newEventId(),
    idempotencyKey: opts.idempotencyKey,
    principalId: opts.principalId,
    userId: opts.principalId,
    payload: {
      actionId: 'Catalog.SeedPackage.Apply',
      resourceType: 'SeedPackage',
      resourceId: null,
      seedPackageKey: seed.packageKey,
      seedPackageVersion: seed.version,
      payload: seed.payload,
    },
  };
  if (!opts.overrides) return base;
  const { payload: payloadOverride, ...rest } = opts.overrides;
  const merged: IntentEnvelope = { ...base, ...rest };
  if (payloadOverride) {
    merged.payload = { ...base.payload, ...payloadOverride } as IntentEnvelope['payload'];
  }
  return merged;
}

/** Intent missing the idempotencyKey — must be rejected. */
export function intentWithoutIdempotencyKey(opts: {
  tenantId: string;
  principalId: string;
}): IntentEnvelope {
  const base = validIntent({
    tenantId: opts.tenantId,
    principalId: opts.principalId,
    idempotencyKey: 'placeholder',
  });
  base.idempotencyKey = '';
  return base;
}

/** Intent with an unknown schemaId — must be rejected with UNKNOWN_SCHEMA. */
export function intentWithUnknownSchema(opts: {
  tenantId: string;
  principalId: string;
}): IntentEnvelope {
  return validIntent({
    tenantId: opts.tenantId,
    principalId: opts.principalId,
    idempotencyKey: uniqueIdempotencyKey('itest-bad-schema'),
    overrides: {
      schemaId: 'nonexistent_schema',
      schemaVersion: 999,
    },
  });
}

/**
 * Intent with a valid schemaId but a payload that fails AJV validation.
 * Must be rejected with SCHEMA_VALIDATION_FAILED.
 */
export function intentWithSchemaMismatch(opts: {
  tenantId: string;
  principalId: string;
}): IntentEnvelope {
  // The catalog.seed_package.apply.v1 schema requires actionId, resourceType,
  // seedPackageKey, seedPackageVersion, and payload.
  const env = validIntent({
    tenantId: opts.tenantId,
    principalId: opts.principalId,
    idempotencyKey: uniqueIdempotencyKey('itest-schema-mis'),
  });
  env.payload = { someOtherField: "doesn't match the schema" } as unknown as IntentEnvelope['payload'];
  return env;
}

/** Intent referencing an actionId that's not in the registry. */
export function intentWithUnknownAction(opts: {
  tenantId: string;
  principalId: string;
}): IntentEnvelope {
  return validIntent({
    tenantId: opts.tenantId,
    principalId: opts.principalId,
    idempotencyKey: uniqueIdempotencyKey('itest-unknown-action'),
    overrides: {
      payload: {
        actionId: 'Nonexistent.Action.Do',
      },
    },
  });
}

/**
 * Intent with a different tenant id than the principal's — must be rejected
 * with TENANT_MISMATCH/403. The Rust suite calls this `intent_for_unauthorized_action`;
 * the TS pipeline labels it TENANT_MISMATCH because tenant scoping is checked
 * before authz runs.
 */
export function intentWithMismatchedTenant(opts: {
  envelopeTenantId: string;
  principalId: string;
}): IntentEnvelope {
  return validIntent({
    tenantId: opts.envelopeTenantId,
    principalId: opts.principalId,
    idempotencyKey: uniqueIdempotencyKey('itest-tenant-mismatch'),
  });
}
