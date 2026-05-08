/**
 * Route-level tests for `apps/server/src/routes/repositories.ts`.
 *
 * Tenant-isolation focus (Invariant I7) — the two acceptance scenarios
 * called out in the upload-tarball spec:
 *
 *   - GET /api/v1/repositories returns the principal's tenant's repos only.
 *   - GET /.../bytes — tenant A cannot fetch tenant B's revision (404, NOT 403,
 *     so existence is not leaked).
 *
 * Mirrors the harness in `identity-a7.test.ts`: in-memory adapter shims
 * are mocked into `@atlas/adapter-node` so the production route code
 * runs unchanged. `ensureTenantMigrated` is stubbed to a no-op since
 * the test doesn't need real Postgres pools.
 */

import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type {
  RepositoryRecord,
  RepositoryRevisionStore,
  RepositoryStore,
  RevisionRecord,
} from '@atlas/ports';
import { repositoryRoutes } from './repositories.ts';
import type { ServerVariables } from '../middleware/principal.ts';
import type { AppState } from '../bootstrap.ts';

// ----------------------------------------------------------------------
// In-memory adapter shims. The store keys by tenantId so a single shared
// instance can hold both tenants' data — the production adapter is bound
// to a per-tenant Postgres pool and ignores the `tenantId` argument, but
// the in-memory version honours it so cross-tenant queries surface as
// the correct null/empty results.
// ----------------------------------------------------------------------

class InMemoryRepositoryStore implements RepositoryStore {
  rows: RepositoryRecord[] = [];
  // Tenant binding is captured by which tenant owns which row. The port
  // signature carries `tenantId` for cross-adapter parity but the
  // production Postgres adapter doesn't filter by it — it relies on the
  // per-tenant pool. The test shim DOES filter so cross-tenant queries
  // can be exercised.
  byTenant = new Map<string, Map<string, RepositoryRecord>>();

  async getBySlug(tenantId: string, repoSlug: string): Promise<RepositoryRecord | null> {
    const t = this.byTenant.get(tenantId);
    if (!t) return null;
    for (const r of t.values()) if (r.repoSlug === repoSlug) return r;
    return null;
  }
  async get(tenantId: string, repoId: string): Promise<RepositoryRecord | null> {
    return this.byTenant.get(tenantId)?.get(repoId) ?? null;
  }
  async list(tenantId: string): Promise<readonly RepositoryRecord[]> {
    return Array.from(this.byTenant.get(tenantId)?.values() ?? []);
  }
  async create(
    tenantId: string,
    input: {
      repoId: string;
      repoSlug: string;
      name: string;
      description?: string;
      createdBy: string;
    },
  ): Promise<void> {
    const t = this.byTenant.get(tenantId) ?? new Map<string, RepositoryRecord>();
    t.set(input.repoId, {
      repoId: input.repoId,
      repoSlug: input.repoSlug,
      name: input.name,
      description: input.description ?? null,
      createdAt: new Date('2026-05-01T00:00:00Z').toISOString(),
      createdBy: input.createdBy,
    });
    this.byTenant.set(tenantId, t);
  }

  /** Test helper — seed without going through the store contract. */
  seed(tenantId: string, row: RepositoryRecord): void {
    const t = this.byTenant.get(tenantId) ?? new Map<string, RepositoryRecord>();
    t.set(row.repoId, row);
    this.byTenant.set(tenantId, t);
  }

  reset(): void {
    this.byTenant.clear();
  }
}

class InMemoryRevisionStore implements RepositoryRevisionStore {
  // Per-tenant revision map: tenantId -> revisionId -> { meta, bytes }
  byTenant = new Map<
    string,
    Map<string, { meta: RevisionRecord; bytes: Uint8Array }>
  >();

  async getMetadata(tenantId: string, revisionId: string): Promise<RevisionRecord | null> {
    return this.byTenant.get(tenantId)?.get(revisionId)?.meta ?? null;
  }
  async listForRepo(
    tenantId: string,
    repoId: string,
  ): Promise<readonly RevisionRecord[]> {
    const t = this.byTenant.get(tenantId);
    if (!t) return [];
    return Array.from(t.values())
      .map((v) => v.meta)
      .filter((m) => m.repoId === repoId);
  }
  async getBytes(tenantId: string, revisionId: string): Promise<Uint8Array | null> {
    return this.byTenant.get(tenantId)?.get(revisionId)?.bytes ?? null;
  }
  async append(
    tenantId: string,
    input: {
      revisionId: string;
      repoId: string;
      bytes: Uint8Array;
      byteCount: number;
      contentHash: string;
      pushedBy: string;
      correlationId: string;
    },
  ): Promise<void> {
    const t = this.byTenant.get(tenantId) ?? new Map<string, { meta: RevisionRecord; bytes: Uint8Array }>();
    t.set(input.revisionId, {
      meta: {
        revisionId: input.revisionId,
        repoId: input.repoId,
        byteCount: input.byteCount,
        contentHash: input.contentHash,
        pushedAt: new Date('2026-05-01T00:00:00Z').toISOString(),
        pushedBy: input.pushedBy,
        correlationId: input.correlationId,
      },
      bytes: input.bytes,
    });
    this.byTenant.set(tenantId, t);
  }

  /** Test helper — seed without going through the store contract. */
  seed(
    tenantId: string,
    meta: RevisionRecord,
    bytes: Uint8Array,
  ): void {
    const t =
      this.byTenant.get(tenantId) ??
      new Map<string, { meta: RevisionRecord; bytes: Uint8Array }>();
    t.set(meta.revisionId, { meta, bytes });
    this.byTenant.set(tenantId, t);
  }

  reset(): void {
    this.byTenant.clear();
  }
}

const repositories = new InMemoryRepositoryStore();
const revisions = new InMemoryRevisionStore();

// ----------------------------------------------------------------------
// Mocks: short-circuit `ensureTenantMigrated` and replace adapter
// constructors with the in-memory shims. Same pattern as
// `identity-a7.test.ts`.
// ----------------------------------------------------------------------

vi.mock('../bootstrap.ts', async () => {
  const actual = await vi.importActual<typeof import('../bootstrap.ts')>('../bootstrap.ts');
  return {
    ...actual,
    ensureTenantMigrated: vi.fn().mockResolvedValue({} as never),
  };
});

vi.mock('@atlas/adapter-node', async () => {
  const actual =
    await vi.importActual<typeof import('@atlas/adapter-node')>('@atlas/adapter-node');
  // Function expressions (not arrows) so `new PostgresRepositoryStore(sql)`
  // can invoke them as constructors. The route code passes a `tenantId`
  // on every method call — the shims read it explicitly so cross-tenant
  // queries return the right null/empty result (the real adapter relies
  // on the per-tenant connection pool for that isolation).
  function FakeRepositoryStore(this: unknown): unknown {
    return repositories;
  }
  function FakeRepositoryRevisionStore(this: unknown): unknown {
    return revisions;
  }
  return {
    ...actual,
    PostgresRepositoryStore: FakeRepositoryStore,
    PostgresRepositoryRevisionStore: FakeRepositoryRevisionStore,
  };
});

// ----------------------------------------------------------------------
// Test fixtures.
// ----------------------------------------------------------------------

function makeState(): AppState {
  return {
    config: {
      port: 3000,
      controlPlaneDbUrl: 'postgres://unused',
      oidc: { issuerUrl: '', jwksUrl: '', audience: '' },
      testAuth: { enabled: true, debugEndpoints: false },
      tenantId: '_platform',
      rustLog: '',
      policyEngine: 'stub' as const,
    },
  } as unknown as AppState;
}

interface PrincipalSpec {
  principalId: string;
  tenantId: string;
}

function buildApp(principal: PrincipalSpec) {
  const app = new Hono<{ Variables: ServerVariables }>();
  app.use('*', async (c, next) => {
    c.set('principal', {
      principalId: principal.principalId,
      tenantId: principal.tenantId,
    });
    c.set('correlationId', 'test-corr');
    await next();
  });
  app.route('/', repositoryRoutes(makeState()));
  return app;
}

beforeEach(() => {
  repositories.reset();
  revisions.reset();
});

// ----------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------

describe('GET /api/v1/repositories', () => {
  test('returns tenant\'s repos only', async () => {
    const tenantA = 'tenant-a';
    const tenantB = 'tenant-b';

    repositories.seed(tenantA, {
      repoId: 'repo-a-1',
      repoSlug: 'alpha',
      name: 'Alpha',
      description: null,
      createdAt: '2026-05-01T00:00:00Z',
      createdBy: 'usr-a',
    });
    repositories.seed(tenantA, {
      repoId: 'repo-a-2',
      repoSlug: 'alpha-two',
      name: 'AlphaTwo',
      description: null,
      createdAt: '2026-05-01T00:00:00Z',
      createdBy: 'usr-a',
    });
    repositories.seed(tenantB, {
      repoId: 'repo-b-1',
      repoSlug: 'bravo',
      name: 'Bravo',
      description: null,
      createdAt: '2026-05-01T00:00:00Z',
      createdBy: 'usr-b',
    });

    const app = buildApp({ principalId: 'usr-a', tenantId: tenantA });
    const res = await app.request('/api/v1/repositories');
    expect(res.status).toBe(200);
    const body = (await res.json()) as RepositoryRecord[];
    const ids = body.map((r) => r.repoId).sort();
    expect(ids).toEqual(['repo-a-1', 'repo-a-2']);
    expect(ids).not.toContain('repo-b-1');
  });
});

describe('GET /.../revisions/:revisionId/bytes', () => {
  test('tenant A cannot fetch tenant B\'s revision (I7) — returns 404', async () => {
    const tenantA = 'tenant-a';
    const tenantB = 'tenant-b';

    // Seed both tenants with a repo + revision each. The revision ids
    // are distinct so nothing collides at the in-memory map level —
    // tenant isolation is what's under test.
    repositories.seed(tenantA, {
      repoId: 'repo-a',
      repoSlug: 'alpha',
      name: 'Alpha',
      description: null,
      createdAt: '2026-05-01T00:00:00Z',
      createdBy: 'usr-a',
    });
    repositories.seed(tenantB, {
      repoId: 'repo-b',
      repoSlug: 'bravo',
      name: 'Bravo',
      description: null,
      createdAt: '2026-05-01T00:00:00Z',
      createdBy: 'usr-b',
    });
    const bytesA = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]); // gzip header-ish
    const bytesB = new Uint8Array([0x1f, 0x8b, 0x08, 0x01]);
    revisions.seed(
      tenantA,
      {
        revisionId: 'rev-a',
        repoId: 'repo-a',
        byteCount: bytesA.byteLength,
        contentHash: 'aaa',
        pushedAt: '2026-05-01T00:00:00Z',
        pushedBy: 'usr-a',
        correlationId: 'corr-a',
      },
      bytesA,
    );
    revisions.seed(
      tenantB,
      {
        revisionId: 'rev-b',
        repoId: 'repo-b',
        byteCount: bytesB.byteLength,
        contentHash: 'bbb',
        pushedAt: '2026-05-01T00:00:00Z',
        pushedBy: 'usr-b',
        correlationId: 'corr-b',
      },
      bytesB,
    );

    // Principal is tenant A asking for tenant B's revision id. We don't
    // even know B's repoId from inside A, but try a few shapes — all
    // must 404, never 403, never leak existence.
    const app = buildApp({ principalId: 'usr-a', tenantId: tenantA });

    // Cross-tenant repoId — A doesn't own repo-b, so the repo lookup
    // 404s before we even get to the revision.
    const r1 = await app.request(
      '/api/v1/repositories/repo-b/revisions/rev-b/bytes',
    );
    expect(r1.status).toBe(404);

    // A owns repo-a, but rev-b is tenant B's revision. The revision
    // metadata read scoped to tenant A returns null → 404.
    const r2 = await app.request(
      '/api/v1/repositories/repo-a/revisions/rev-b/bytes',
    );
    expect(r2.status).toBe(404);

    // Sanity check: A CAN fetch its own revision.
    const r3 = await app.request(
      '/api/v1/repositories/repo-a/revisions/rev-a/bytes',
    );
    expect(r3.status).toBe(200);
    expect(r3.headers.get('Content-Type')).toBe('application/gzip');
    expect(r3.headers.get('Content-Disposition') ?? '').toContain('alpha-rev-a.tar.gz');
    const buf = new Uint8Array(await r3.arrayBuffer());
    expect(Array.from(buf)).toEqual(Array.from(bytesA));
  });
});
