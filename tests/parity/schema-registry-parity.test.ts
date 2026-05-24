/**
 * Registry dynamic-registration parity — node (Postgres) vs idb (in-memory).
 *
 * Parity in Atlas is enforced by BOTH adapters running the SAME contract suite
 * (`controlPlaneRegistryDynamicContract` in `@atlas/contract-tests`):
 *   - node side: `adapters/node/test/control-plane-registry.test.ts`
 *   - idb side:  `adapters/idb/test/control-plane-registry.test.ts`
 * If both pass that suite, the observable dynamic-registration behavior agrees
 * by construction. This parity file additionally exercises the idb adapter
 * directly here (it is the only adapter resolvable from `tests/parity/`, which
 * is not a workspace package — the node adapter is reached over HTTP in the
 * other `*-node.test.ts` files, but registry registration has no HTTP surface
 * by design, so the cross-adapter agreement is asserted via the shared suite).
 *
 * Expected result TODAY: **FAILS** — the idb registry does not yet observe a
 * runtime-written row, so the after-write resolution is false. When the
 * capability lands, both adapters resolve the runtime row identically.
 *
 * @spec: specs/domains/runtime/capabilities/control-plane-schema-registry/README.md#acceptance
 */
import { describe, test, expect } from '@atlas/test';
import {
  InMemoryControlPlaneRegistry,
  type InMemorySchemaRegistryStore,
} from '@atlas/adapter-idb';
import type { ControlPlaneRegistry } from '@atlas/ports';

const SCHEMA_ID = 'parity.hot_register.v1';
const SCHEMA_VERSION = 1;
function schemaDocument(): Record<string, unknown> {
  return {
    $id: SCHEMA_ID,
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' } },
    additionalProperties: false,
  };
}

/** Probe a registry: is the schema resolvable before vs after a runtime write? */
interface RegistryProbe {
  before: boolean;
  after: boolean;
}

function probeIdb(): RegistryProbe {
  const store: InMemorySchemaRegistryStore = {
    schemas: new Map(),
    actions: new Map(),
    version: 0,
  };
  const registry: ControlPlaneRegistry = new InMemoryControlPlaneRegistry(undefined, store);
  const before = registry.getSchemaValidator(SCHEMA_ID, SCHEMA_VERSION) != null;
  store.schemas.set(`${SCHEMA_ID}:${SCHEMA_VERSION}`, {
    schemaId: SCHEMA_ID,
    schemaVersion: SCHEMA_VERSION,
    document: schemaDocument(),
    source: 'registered',
  });
  store.version += 1;
  const after = registry.getSchemaValidator(SCHEMA_ID, SCHEMA_VERSION) != null;
  return { before, after };
}

describe('[parity] registry dynamic registration agrees across node and idb', function () {
  test('idb: unregistered → unresolvable; after runtime write → resolvable', function () {
    const idb = probeIdb();
    expect(idb.before, 'unregistered schema must be unresolvable').toBe(false);
    // The cross-adapter parity invariant: the Postgres adapter, running the
    // same contract suite at adapters/node/test/control-plane-registry.test.ts,
    // resolves a runtime-written row — the idb mirror MUST agree.
    expect(
      idb.after,
      'after a runtime registry write, the idb adapter MUST resolve the row — matching ' +
        'the Postgres adapter under the shared controlPlaneRegistryDynamicContract suite',
    ).toBe(true);
  });
});
