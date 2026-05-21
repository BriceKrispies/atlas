/**
 * In-memory `DslArtifactStore` for unit tests.
 *
 * Mirrors the Postgres adapter's externally-observable behaviour:
 *   - `ensureKindRegistered` is idempotent; tables are implicit maps.
 *   - `save` mints a fresh UUID for first-time saves, copies the prior
 *     row to the versions list for subsequent saves, and increments
 *     `version` monotonically.
 *   - `get`/`getVersion`/`getById`/`list` walk the maps.
 *
 * Lives under `_test-lib/` to keep it out of the package's public
 * surface (no `index.ts` re-export). Test files import it directly.
 */

import type { DslArtifactStore, SaveDslArtifactInput, SaveDslArtifactResult } from '@atlas/ports';
import type { DslArtifact } from '@atlas/dsl-substrate';
import { DSL_KIND_PATTERN } from '@atlas/dsl-substrate';

interface KindMaps {
  byApiName: Map<string, DslArtifact<string, unknown>>;
  byArtifactId: Map<string, DslArtifact<string, unknown>>;
  versions: DslArtifact<string, unknown>[];
}

function assertKind(kind: string): void {
  if (!DSL_KIND_PATTERN.test(kind)) {
    throw new Error(`invalid DSL kind '${kind}'`);
  }
}

let nextUuidCounter = 1;
function fakeUuid(): string {
  // Deterministic-enough for tests; not real UUIDs.
  const n = nextUuidCounter.toString(16).padStart(8, '0');
  nextUuidCounter += 1;
  return `00000000-0000-4000-8000-${n.padStart(12, '0')}`;
}

export class MemoryDslArtifactStore implements DslArtifactStore {
  private readonly kinds = new Map<string, KindMaps>();

  private kindMaps(kind: string): KindMaps {
    let maps = this.kinds.get(kind);
    if (!maps) {
      maps = { byApiName: new Map(), byArtifactId: new Map(), versions: [] };
      this.kinds.set(kind, maps);
    }
    return maps;
  }

  async ensureKindRegistered(kind: string): Promise<void> {
    assertKind(kind);
    this.kindMaps(kind);
  }

  async save<TAst>(input: SaveDslArtifactInput<TAst>): Promise<SaveDslArtifactResult<TAst>> {
    assertKind(input.kind);
    const maps = this.kindMaps(input.kind);
    const existing = maps.byApiName.get(input.apiName);
    const now = new Date().toISOString();

    if (!existing) {
      const artifact: DslArtifact<string, TAst> = {
        kind: input.kind,
        artifactId: fakeUuid(),
        apiName: input.apiName,
        tenantId: input.tenantId,
        version: 1,
        substrateVersion: input.substrateVersion,
        source: input.source,
        ast: input.ast,
        sourceMap: input.sourceMap,
        dependencies: input.dependencies,
        createdAt: now,
        updatedAt: now,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
      };
      maps.byApiName.set(input.apiName, artifact as DslArtifact<string, unknown>);
      maps.byArtifactId.set(artifact.artifactId, artifact as DslArtifact<string, unknown>);
      return { artifact, outcome: 'inserted' };
    }

    // Versioned save. Copy prior to versions list.
    maps.versions.push(existing);
    const nextVersion = existing.version + 1;
    const artifact: DslArtifact<string, TAst> = {
      kind: input.kind,
      artifactId: existing.artifactId,
      apiName: input.apiName,
      tenantId: input.tenantId,
      version: nextVersion,
      substrateVersion: input.substrateVersion,
      source: input.source,
      ast: input.ast,
      sourceMap: input.sourceMap,
      dependencies: input.dependencies,
      createdAt: existing.createdAt,
      updatedAt: now,
      createdBy: existing.createdBy,
      updatedBy: input.createdBy,
    };
    maps.byApiName.set(input.apiName, artifact as DslArtifact<string, unknown>);
    maps.byArtifactId.set(artifact.artifactId, artifact as DslArtifact<string, unknown>);
    return { artifact, outcome: 'versioned' };
  }

  async get<TAst>(kind: string, apiName: string): Promise<DslArtifact<string, TAst> | null> {
    assertKind(kind);
    const maps = this.kinds.get(kind);
    if (!maps) return null;
    return (maps.byApiName.get(apiName) as DslArtifact<string, TAst> | undefined) ?? null;
  }

  async getVersion<TAst>(
    kind: string,
    apiName: string,
    version: number,
  ): Promise<DslArtifact<string, TAst> | null> {
    assertKind(kind);
    const maps = this.kinds.get(kind);
    if (!maps) return null;
    const current = maps.byApiName.get(apiName);
    if (current && current.version === version) {
      return current as DslArtifact<string, TAst>;
    }
    const found = maps.versions.find((a) => a.apiName === apiName && a.version === version);
    return (found as DslArtifact<string, TAst> | undefined) ?? null;
  }

  async getById<TAst>(kind: string, artifactId: string): Promise<DslArtifact<string, TAst> | null> {
    assertKind(kind);
    const maps = this.kinds.get(kind);
    if (!maps) return null;
    return (maps.byArtifactId.get(artifactId) as DslArtifact<string, TAst> | undefined) ?? null;
  }

  async list<TAst>(kind: string): Promise<ReadonlyArray<DslArtifact<string, TAst>>> {
    assertKind(kind);
    const maps = this.kinds.get(kind);
    if (!maps) return [];
    return [...maps.byApiName.values()].sort((a, b) =>
      a.apiName < b.apiName ? -1 : a.apiName > b.apiName ? 1 : 0,
    ) as ReadonlyArray<DslArtifact<string, TAst>>;
  }
}
