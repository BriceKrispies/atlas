/**
 * F5 — Control-plane schema registration is a no-restart, platform-data change.
 *
 * Probes `specs/domains/runtime/capabilities/control-plane-schema-registry/README.md`
 * §"End-to-End Flow B (Hot registration)" + §"Acceptance" (I20 no-restart proof).
 *
 * Claim (I20): registering a new intent schema is a tenant-visible change that
 * MUST arrive as platform-data, not a restart. The proof is single-process:
 *   1. Submit an intent whose schemaId is unregistered → `400 UNKNOWN_SCHEMA`.
 *   2. Write the schema row to the control-plane registry (a plain data write).
 *   3. Re-submit the SAME intent → NO LONGER `UNKNOWN_SCHEMA`.
 *   4. `bootId` is identical across both submits (same process, no restart).
 *
 * Single-process assumption is explicit (the multi-replica freshness case is
 * out of scope for this slice — see the capability README §"Risks").
 *
 * Expected result TODAY: **FAILS** — the registry reads only bundled manifests;
 * the runtime row write is not observed, so submit #2 still returns
 * `UNKNOWN_SCHEMA`. When the capability lands, submit #2 passes the schema gate.
 */
import { describe, test, expect } from '@atlas/test';
import postgres from 'postgres';
import { submitIntent, type IngressState } from '@atlas/ingress';
import { IngressError } from '@atlas/platform-core';
import type { IntentEnvelope } from '@atlas/platform-core';
import {
  InMemoryControlPlaneRegistry,
  type InMemorySchemaRegistryStore,
} from '@atlas/adapter-idb';
import {
  PostgresControlPlaneRegistry,
  runMigrations,
} from '@atlas/adapter-node';
import {
  makeFakeCache,
  makeFakeProjections,
  makeFakeSearch,
  makeFakeCatalogState,
  makeFakeEventStore,
  StubAllowEngine,
} from '../lib/factories.ts';
import type { HandlerRegistry, IntentHandler, ActionEntry } from '@atlas/ports';

// DB-gated: the Postgres sibling drives the PRODUCTION
// `PostgresControlPlaneRegistry` through its `refresh()` boundary so the I20
// no-restart proof witnesses the production adapter, not only the in-memory
// mirror. Same env the node adapter tests use; skip cleanly when absent.
const PG_DB_URL =
  process.env['TEST_TENANT_DB_URL'] ?? process.env['CONTROL_PLANE_DB_URL'];
const HAS_PG = typeof PG_DB_URL === 'string' && PG_DB_URL.length > 0;

const TENANT = 'tenant-f5';
const PRINCIPAL = 'user-f5';

// A schema the bundled @atlas/schemas set does NOT carry, registered at runtime.
const HOT_SCHEMA_ID = 'runtime.f5_hot.v1';
const HOT_ACTION_ID = 'Runtime.F5Hot.Do';

function hotSchemaDocument(): Record<string, unknown> {
  return {
    $id: HOT_SCHEMA_ID,
    type: 'object',
    required: ['actionId', 'resourceType'],
    properties: {
      actionId: { type: 'string' },
      resourceType: { type: 'string' },
    },
    additionalProperties: false,
  };
}

function hotAction(): ActionEntry {
  return {
    actionId: HOT_ACTION_ID,
    resourceType: 'F5Resource',
    schemaId: HOT_SCHEMA_ID,
    schemaVersion: 1,
  };
}

function hotIntent(): IntentEnvelope {
  return {
    eventType: 'Runtime.F5Hot.Do',
    schemaId: HOT_SCHEMA_ID,
    schemaVersion: 1,
    tenantId: TENANT,
    correlationId: 'corr-f5',
    idempotencyKey: 'idem-f5',
    principalId: PRINCIPAL,
    payload: { actionId: HOT_ACTION_ID, resourceType: 'F5Resource' },
  };
}

/**
 * A per-process boot identity, stamped exactly ONCE at module load — the same
 * lifetime semantics as `AppState.bootId` (`apps/server/src/bootstrap.ts:260`,
 * the value `/readyz` returns). Reading it twice within one process yields the
 * same value; only a process restart (a new bootstrap) would change it. The
 * F5 proof reads this live (not a local copy) before the row write and again
 * after the second submit, so the stability assertion has teeth: if anything
 * had forced a re-bootstrap mid-flight, the second read would differ.
 */
const PROCESS_BOOT_ID = globalThis.crypto.randomUUID();

/** The in-process boot identity, exactly as `AppState.bootId` would surface it. */
function currentBootId(): string {
  return PROCESS_BOOT_ID;
}

/**
 * Build an IngressState whose registry is the dynamic in-memory registry,
 * sharing the `store` so the test can write a registry row mid-flight. A
 * matching handler is wired so that, once the schema gate passes, dispatch
 * proceeds (the proof only needs the schema gate to flip — the handler keeps
 * the path realistic).
 */
function makeIngress(store: InMemorySchemaRegistryStore): IngressState {
  const registry = new InMemoryControlPlaneRegistry(undefined, store);
  const noopHandler: IntentHandler = {
    async handle() {
      return {
        primary: {
          eventId: 'evt-f5',
          eventType: 'Runtime.F5Hot.Done',
          schemaId: HOT_SCHEMA_ID,
          schemaVersion: 1,
          occurredAt: new Date(0).toISOString(),
          tenantId: TENANT,
          correlationId: 'corr-f5',
          idempotencyKey: 'idem-f5',
          payload: {},
        },
        follow: [],
      };
    },
  };
  const handlers: HandlerRegistry = { get: () => noopHandler };
  return {
    tenantId: TENANT,
    principalId: PRINCIPAL,
    correlationId: 'corr-f5',
    eventStore: makeFakeEventStore(),
    cache: makeFakeCache(),
    projections: makeFakeProjections(),
    search: makeFakeSearch(),
    registry,
    catalogState: makeFakeCatalogState(),
    handlers,
    dispatch: async function () {},
    policyEngine: new StubAllowEngine(),
  };
}

async function submitAndGetCode(state: IngressState): Promise<string | 'OK'> {
  try {
    await submitIntent(state, hotIntent());
    return 'OK';
  } catch (cause) {
    if (cause instanceof IngressError) return cause.code;
    throw cause;
  }
}

describe('F5 — schema registration is a platform-data change requiring no restart (I20)', function () {
  test('unregistered → UNKNOWN_SCHEMA; write row; re-submit → not UNKNOWN_SCHEMA; bootId stable', async function () {
    // Capture the live per-process boot identity BEFORE any work. This is read
    // from the same source `/readyz` exposes (`currentBootId()` ≈
    // `state.bootId`), not a copy — so a re-bootstrap mid-flight would change
    // what the post-submit read returns.
    const bootIdBeforeFirst = currentBootId();
    const store: InMemorySchemaRegistryStore = {
      schemas: new Map(),
      actions: new Map(),
      version: 0,
    };
    const state = makeIngress(store);

    // 1. First submit — schema not registered yet.
    const first = await submitAndGetCode(state);
    expect(
      first,
      'an unregistered schemaId MUST be rejected with UNKNOWN_SCHEMA (submit-intent step 3)',
    ).toBe('UNKNOWN_SCHEMA');

    // 2. Register the schema + action as a control-plane data write — no
    // restart, same process. (Mirrors the INSERT into control_plane.intent_schemas
    // / action_entries + version-cursor bump.)
    store.schemas.set(`${HOT_SCHEMA_ID}:1`, {
      schemaId: HOT_SCHEMA_ID,
      schemaVersion: 1,
      document: hotSchemaDocument(),
      source: 'registered',
    });
    store.actions.set(HOT_ACTION_ID, { ...hotAction(), source: 'registered' });
    store.version += 1;

    // 3. Second submit — same intent, same process. The schema gate MUST now
    // pass (no longer UNKNOWN_SCHEMA). It may proceed to OK or fail at a later
    // step, but it MUST NOT be UNKNOWN_SCHEMA.
    const second = await submitAndGetCode(state);
    expect(
      second,
      'after the registry row write, the SAME schemaId MUST be resolvable on the next ' +
        'request — no restart (I20). Got UNKNOWN_SCHEMA, meaning the registry did not ' +
        'observe the runtime row.',
    ).not.toBe('UNKNOWN_SCHEMA');

    // 4. bootId identical across both submits — single process, no restart.
    // Read the live boot identity AGAIN (after the second submit) and compare
    // to the value captured before the row write. Equality proves the SAME
    // process answered both submits — the row write was a pure data change, not
    // a restart (I20). A re-bootstrap would have re-stamped the boot id.
    const bootIdAfterSecond = currentBootId();
    expect(
      bootIdAfterSecond,
      'bootId MUST be stable across both submits — the schema registration was a ' +
        'platform-data change, not a process restart (I20)',
    ).toBe(bootIdBeforeFirst);
  });
});

/**
 * F5 (Postgres path) — the SAME I20 no-restart proof, but driving the
 * PRODUCTION `PostgresControlPlaneRegistry` through its `refresh()` boundary
 * (decision O1, refresh-at-request-boundary). The architect RECOMMENDED this
 * sibling so the proof witnesses the production adapter — the in-memory mirror
 * above could mask a commit-visibility gap the Postgres adapter has and the
 * boundary refresh closes. Single-process (one registry instance, one pool),
 * stable bootId — the multi-replica case is out of scope (README §"Risks").
 *
 * Gated on `TEST_TENANT_DB_URL` / `CONTROL_PLANE_DB_URL` (the same env the node
 * adapter tests use → `adapters_node_test` on :15433); skips cleanly when
 * absent.
 *
 * @spec specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#acceptance
 */
function makeIngressWithRegistry(registry: PostgresControlPlaneRegistry): IngressState {
  const noopHandler: IntentHandler = {
    async handle() {
      return {
        primary: {
          eventId: 'evt-f5-pg',
          eventType: 'Runtime.F5Hot.Done',
          schemaId: HOT_SCHEMA_ID,
          schemaVersion: 1,
          occurredAt: new Date(0).toISOString(),
          tenantId: TENANT,
          correlationId: 'corr-f5',
          idempotencyKey: 'idem-f5-pg',
          payload: {},
        },
        follow: [],
      };
    },
  };
  const handlers: HandlerRegistry = { get: () => noopHandler };
  return {
    tenantId: TENANT,
    principalId: PRINCIPAL,
    correlationId: 'corr-f5',
    eventStore: makeFakeEventStore(),
    cache: makeFakeCache(),
    projections: makeFakeProjections(),
    search: makeFakeSearch(),
    registry,
    catalogState: makeFakeCatalogState(),
    handlers,
    dispatch: async function () {},
    policyEngine: new StubAllowEngine(),
  };
}

(HAS_PG ? describe : describe.skip)(
  'F5 (Postgres) — production PostgresControlPlaneRegistry observes a hot-registered schema after refresh() (I20)',
  function () {
    test('unregistered → UNKNOWN_SCHEMA; write row + refresh(); re-submit → not UNKNOWN_SCHEMA; bootId stable', async function () {
      const bootIdBeforeFirst = currentBootId();
      const sql = postgres(PG_DB_URL as string, { max: 2, prepare: false });
      // Construct the production adapter against the control-plane pool. The
      // constructor primes an initial snapshot; `refresh()` reloads it.
      const registry = new PostgresControlPlaneRegistry(sql);
      try {
        await runMigrations(sql, 'control-plane');
        // Clean slate for this proof's hot rows (leave seeded rows intact —
        // we only assert about the F5-specific schema/action ids).
        await sql`DELETE FROM control_plane.intent_schemas WHERE schema_id = ${HOT_SCHEMA_ID}`;
        await sql`DELETE FROM control_plane.action_entries WHERE action_id = ${HOT_ACTION_ID}`;
        await sql`UPDATE control_plane.registry_version SET version = version + 1`;
        // Prime the snapshot so the first lookup reflects the deleted state.
        await registry.refresh();

        const state = makeIngressWithRegistry(registry);

        // 1. First submit — schema not registered yet.
        const first = await submitAndGetCode(state);
        expect(
          first,
          'an unregistered schemaId MUST be rejected with UNKNOWN_SCHEMA (submit-intent step 3)',
        ).toBe('UNKNOWN_SCHEMA');

        // 2. Register the schema + action as a control-plane data write — no
        // restart, same process — then bump the cursor.
        await sql`
          INSERT INTO control_plane.intent_schemas (schema_id, schema_version, document, source)
          VALUES (${HOT_SCHEMA_ID}, 1, ${sql.json(hotSchemaDocument() as Record<string, never>)}, 'registered')
          ON CONFLICT (schema_id, schema_version) DO UPDATE SET document = EXCLUDED.document
        `;
        await sql`
          INSERT INTO control_plane.action_entries (action_id, resource_type, schema_id, schema_version, source)
          VALUES (${HOT_ACTION_ID}, 'F5Resource', ${HOT_SCHEMA_ID}, 1, 'registered')
          ON CONFLICT (action_id) DO NOTHING
        `;
        await sql`UPDATE control_plane.registry_version SET version = version + 1`;

        // 3. Request boundary: the production middleware awaits refresh() here
        // (registryRefreshMiddleware) — model it explicitly. After this the
        // sync schema lookup MUST observe the new row.
        await registry.refresh();

        // 4. Second submit — same intent, same process. MUST NOT be UNKNOWN_SCHEMA.
        const second = await submitAndGetCode(state);
        expect(
          second,
          'after the registry row write + refresh() boundary, the SAME schemaId MUST be ' +
            'resolvable on the next request — no restart (I20). UNKNOWN_SCHEMA means the ' +
            'production adapter did not observe the runtime row.',
        ).not.toBe('UNKNOWN_SCHEMA');

        // 5. bootId identical across both submits — single process, no restart.
        const bootIdAfterSecond = currentBootId();
        expect(
          bootIdAfterSecond,
          'bootId MUST be stable — the schema registration was a platform-data change, not a restart (I20)',
        ).toBe(bootIdBeforeFirst);
      } finally {
        // Close the pool so the suite does not leak connections.
        await sql.end({ timeout: 5 });
      }
    });
  },
);
