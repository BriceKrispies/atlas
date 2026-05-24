import {
  controlPlaneRegistryContract,
  controlPlaneRegistryDynamicContract,
  type DynamicRegistryHarness,
  type SchemaRegistryDoc,
} from '@atlas/contract-tests';
import type { ActionEntry } from '@atlas/ports';
import {
  InMemoryControlPlaneRegistry,
  seedInMemorySchemaRegistry,
  type InMemorySchemaRegistryStore,
} from '@atlas/adapter-idb';

// Static (bundled-manifest) contract — always runs, no IDB connection needed.
// @spec: specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#surfaces
controlPlaneRegistryContract(async function () {
  return new InMemoryControlPlaneRegistry();
});

// Dynamic-registration + seed-idempotency contract — the in-memory mirror of
// the Postgres registry-as-data path. The registry observes a written row on
// the next sync lookup via the in-memory version cursor.
//
// @spec: specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#acceptance
controlPlaneRegistryDynamicContract(async function (): Promise<DynamicRegistryHarness> {
  // The in-memory store that backs the dynamic registry (mirror of the IDB
  // `intentSchemas` / `actionEntries` object stores + version counter). Phase
  // 1.1 wires the InMemoryControlPlaneRegistry to read from this store; until
  // then the registry reads only bundled manifests, so post-register lookups
  // return null and the assertions fail for the intended behavior-gap reason.
  const store: InMemorySchemaRegistryStore = {
    schemas: new Map(),
    actions: new Map(),
    version: 0,
  };
  const registry = new InMemoryControlPlaneRegistry(undefined, store);

  function schemaKey(id: string, v: number): string {
    return `${id}:${v}`;
  }

  return {
    registry,
    async registerSchema(doc: SchemaRegistryDoc): Promise<void> {
      store.schemas.set(schemaKey(doc.schemaId, doc.schemaVersion), {
        schemaId: doc.schemaId,
        schemaVersion: doc.schemaVersion,
        document: doc.document,
        source: doc.source ?? 'registered',
      });
      store.version += 1;
    },
    async registerAction(entry: ActionEntry & { source?: 'seed' | 'registered' }): Promise<void> {
      if (!store.actions.has(entry.actionId)) {
        store.actions.set(entry.actionId, { ...entry, source: entry.source ?? 'registered' });
        store.version += 1;
      }
    },
    async reseed(): Promise<void> {
      await seedInMemorySchemaRegistry(store);
    },
    async readSource(schemaId, schemaVersion) {
      return store.schemas.get(schemaKey(schemaId, schemaVersion))?.source ?? null;
    },
    // No-op: the in-process store has NO async commit-visibility gap, so a
    // write is observed by the sync lookups immediately — there is no
    // boundary refresh to perform. This asymmetry vs the Postgres harness
    // (which awaits `registry.refresh()`) is the honest parity statement:
    // idb has no commit-visibility gap to bridge, Postgres does (decision O1).
    refreshBoundary: async () => {},
    // No-op: the in-memory store holds no factory-acquired resource to
    // release (the Postgres harness closes its pool here).
    teardown: async () => {},
  };
});
