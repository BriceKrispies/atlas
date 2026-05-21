/**
 * Cross-adapter contract for `RepositoryStore` + `RepositoryRevisionStore`.
 *
 * IDB suite intentionally skipped — `IdbRepositoryStore` throws on every
 * method by design; see capability spec
 * `specs/domains/code/repository/capabilities/upload-tarball/README.md`
 * (section "Surfaces" → "Adapter") and the "IDB parity confirmed not
 * required" note in the same spec. The Postgres factory in
 * `adapters/node/test/repository-store.test.ts` is currently the only
 * runner of this suite.
 *
 * Notes on cross-tenant isolation (test 4):
 *   The port surface takes a `tenantId` argument for cross-adapter parity,
 *   but the Postgres adapter is bound to a per-tenant DB at the connection
 *   level — the implementation does NOT filter by a `tenant_id` column.
 *   That means within a single `Sql` connection, "another tenant's row"
 *   doesn't exist physically. We test the property by asking the factory
 *   for a *second* connection (a fresh, isolated DB / schema reset) and
 *   asserting the second connection sees nothing the first wrote. If the
 *   factory cannot supply a second connection, the test skips with a
 *   pinned comment so the contract intent is still recorded.
 */
import { describe, test, expect, beforeEach } from '@atlas/test';
import type {
  RepositoryStore,
  RepositoryRevisionStore,
  RepositoryRecord,
  RevisionRecord,
} from '@atlas/ports';
import { assertDefined } from '@atlas/test-fixtures/assert';
export interface RepositoryStoreFactoryResult {
  store: RepositoryStore;
  revisions: RepositoryRevisionStore;
  /**
   * Optional second-connection factory for the cross-tenant isolation
   * test. When omitted, the cross-tenant case is skipped with a pinned
   * comment (see file-level docblock).
   */
  freshOtherTenant?: () => Promise<{
    store: RepositoryStore;
    revisions: RepositoryRevisionStore;
  }>;
  dispose?: () => Promise<void> | void;
}
export interface RepositoryStoreFactoryOptions {
  factory: () => Promise<RepositoryStoreFactoryResult>;
}
let counter = 0;
function fresh(prefix: string): string {
  counter++;
  return `${prefix}-${counter.toString(36)}-${Date.now().toString(36)}`;
}
const TENANT = 'tenant-repo-contract';
interface MakeRepoOpts {
  repoId?: string;
  repoSlug?: string;
  name?: string;
  description?: string | null;
  createdBy?: string;
}
function makeRepoInput(opts: MakeRepoOpts = {}): {
  repoId: string;
  repoSlug: string;
  name: string;
  description?: string;
  createdBy: string;
} {
  const repoId = opts.repoId ?? fresh('repo');
  const out: {
    repoId: string;
    repoSlug: string;
    name: string;
    description?: string;
    createdBy: string;
  } = {
    repoId,
    repoSlug: opts.repoSlug ?? fresh('slug'),
    name: opts.name ?? 'Hello World',
    createdBy: opts.createdBy ?? 'user:test',
  };
  if (typeof opts.description === 'string') out.description = opts.description;
  return out;
}
interface MakeRevisionOpts {
  revisionId?: string;
  repoId: string;
  bytes?: Uint8Array;
  contentHash?: string;
  pushedBy?: string;
  correlationId?: string;
}
function makeRevisionInput(opts: MakeRevisionOpts): {
  revisionId: string;
  repoId: string;
  bytes: Uint8Array;
  byteCount: number;
  contentHash: string;
  pushedBy: string;
  correlationId: string;
} {
  const bytes = opts.bytes ?? new Uint8Array([1, 2, 3, 4, 5]);
  return {
    revisionId: opts.revisionId ?? fresh('rev'),
    repoId: opts.repoId,
    bytes,
    byteCount: bytes.byteLength,
    contentHash: opts.contentHash ?? 'sha256:placeholder',
    pushedBy: opts.pushedBy ?? 'user:test',
    correlationId: opts.correlationId ?? fresh('corr'),
  };
}
export function runRepositoryStoreContract(opts: RepositoryStoreFactoryOptions): void {
  describe('RepositoryStore + RepositoryRevisionStore contract', function () {
    let store: RepositoryStore;
    let revisions: RepositoryRevisionStore;
    let result: RepositoryStoreFactoryResult;
    beforeEach(async function () {
      if (result?.dispose) {
        await result.dispose();
      }
      result = await opts.factory();
      store = result.store;
      revisions = result.revisions;
    });
    test('create + getBySlug + get + list round-trip', async function () {
      const input = makeRepoInput({ repoSlug: 'hello-world', name: 'Hello' });
      await store.create(TENANT, input);
      const bySlug = assertDefined(
        await store.getBySlug(TENANT, 'hello-world'),
        'getBySlug returns the row just created',
      );
      expect(bySlug.repoId).toBe(input.repoId);
      expect(bySlug.repoSlug).toBe('hello-world');
      expect(bySlug.name).toBe('Hello');
      const byId = assertDefined(
        await store.get(TENANT, input.repoId),
        'get(repoId) returns the row just created',
      );
      expect(byId.repoId).toBe(input.repoId);
      const all = await store.list(TENANT);
      const ids = all.map(function (r: RepositoryRecord) {
        return r.repoId;
      });
      expect(ids).toContain(input.repoId);
    });
    test('create idempotency at adapter level — duplicate (tenantId, repoSlug) throws', async function () {
      // The handler layer is responsible for idempotency (look-then-create
      // via `getBySlug`). The adapter raises on the unique-index conflict
      // so the bug is loud rather than silently shadowing a row. This test
      // pins that the conflict surfaces as a thrown error.
      const input = makeRepoInput({ repoSlug: 'collide-slug' });
      await store.create(TENANT, input);
      const dupe = makeRepoInput({ repoSlug: 'collide-slug' }); // fresh repoId
      await expect(store.create(TENANT, dupe)).rejects.toThrow();
    });
    test('getBySlug returns null for unknown slug', async function () {
      const got = await store.getBySlug(TENANT, 'no-such-slug');
      expect(got).toBeNull();
    });
    test('get returns null for cross-tenant lookup', async function () {
      // Per-tenant DBs enforce isolation at the connection level — the
      // adapter binds to a single tenant DB and does not filter by a
      // `tenant_id` column. We model "another tenant" by asking the
      // factory for a second, fresh connection and asserting that
      // connection sees nothing tenant A wrote. If the factory cannot
      // supply a second connection, skip with a pinned comment.
      if (!result.freshOtherTenant) {
        // tenantId is part of the type contract for parity but per-tenant
        // DBs enforce isolation at the connection level; this factory
        // doesn't model a second connection, so the test is documented
        // and skipped.
        return;
      }
      const input = makeRepoInput({ repoSlug: 'tenant-a-only' });
      await store.create('tenant-a', input);
      const other = await result.freshOtherTenant();
      const fromB = await other.store.getBySlug('tenant-b', 'tenant-a-only');
      expect(fromB).toBeNull();
      const byIdFromB = await other.store.get('tenant-b', input.repoId);
      expect(byIdFromB).toBeNull();
    });
    test('append + getMetadata + listForRepo + getBytes round-trip', async function () {
      const repo = makeRepoInput();
      await store.create(TENANT, repo);
      const originalBytes = new Uint8Array([10, 20, 30, 40, 50, 60]);
      const rev = makeRevisionInput({
        repoId: repo.repoId,
        bytes: originalBytes,
        contentHash: 'sha256:abc',
      });
      await revisions.append(TENANT, rev);
      const meta = assertDefined(
        await revisions.getMetadata(TENANT, rev.revisionId),
        'getMetadata returns the revision just appended',
      );
      expect(meta.revisionId).toBe(rev.revisionId);
      expect(meta.repoId).toBe(repo.repoId);
      expect(meta.byteCount).toBe(originalBytes.byteLength);
      expect(meta.contentHash).toBe('sha256:abc');
      expect(meta.correlationId).toBe(rev.correlationId);
      const list = await revisions.listForRepo(TENANT, repo.repoId);
      expect(
        list.map(function (r: RevisionRecord) {
          return r.revisionId;
        }),
      ).toEqual([rev.revisionId]);
      const got = assertDefined(
        await revisions.getBytes(TENANT, rev.revisionId),
        'getBytes returns the revision just appended',
      );
      // Compare element-wise — `Buffer` extends `Uint8Array` but
      // `toEqual` may differ on prototype; convert both to plain arrays.
      const roundTripped = Array.from(got);
      expect(roundTripped).toEqual(Array.from(originalBytes));
    });
    test('listForRepo returns most-recent first', async function () {
      const repo = makeRepoInput();
      await store.create(TENANT, repo);
      // Append three revisions with explicit small sleeps so `pushed_at`
      // (set by `now()` in the migration default) is monotonically
      // increasing. The list contract is newest-first.
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const rev = makeRevisionInput({ repoId: repo.repoId });
        ids.push(rev.revisionId);
        await revisions.append(TENANT, rev);
        // 10 ms is plenty for `now()` to tick on Postgres.
        await new Promise(function (resolve) {
          return setTimeout(resolve, 10);
        });
      }
      const list = await revisions.listForRepo(TENANT, repo.repoId);
      // Newest first → reversed insertion order.
      expect(
        list.map(function (r: RevisionRecord) {
          return r.revisionId;
        }),
      ).toEqual([...ids].reverse());
    });
    test('getBytes returns null for unknown revision id', async function () {
      const got = await revisions.getBytes(TENANT, 'no-such-revision');
      expect(got).toBeNull();
    });
    test('bytes are exactly the BYTEA inserted (no encoding drift)', async function () {
      const repo = makeRepoInput();
      await store.create(TENANT, repo);
      // Explicit binary content with non-ascii bytes — high bit set,
      // null bytes, full byte range. Anything that loses fidelity (e.g.
      // accidental UTF-8 round-tripping) will corrupt these.
      const original = new Uint8Array([
        0x00, 0x01, 0x7f, 0x80, 0x81, 0xff, 0xfe, 0xc3, 0x28, 0xa0, 0x42, 0x00, 0x10,
      ]);
      const rev = makeRevisionInput({
        repoId: repo.repoId,
        bytes: original,
        contentHash: 'sha256:binary-fixture',
      });
      await revisions.append(TENANT, rev);
      const got = assertDefined(
        await revisions.getBytes(TENANT, rev.revisionId),
        'getBytes returns the binary revision just appended',
      );
      // Raw byte-by-byte comparison.
      const rawRound = Array.from(got);
      expect(rawRound).toEqual(Array.from(original));
      // Base64 round-trip — encode both sides, compare strings.
      const toB64 = function (u: Uint8Array): string {
        return Buffer.from(u).toString('base64');
      };
      expect(toB64(got)).toBe(toB64(original));
      // Length sanity — caught any silent truncation.
      expect(got.byteLength).toBe(original.byteLength);
    });
  });
}
