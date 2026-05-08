/**
 * RepositoryStore + RepositoryRevisionStore — tenant-scoped persistence
 * for the Code platform's `repository` domain. Backs the `upload-tarball`
 * capability: `atlasctl push <dir>` lands here as one repository row plus
 * one revision row (bytes + metadata). See
 * `specs/domains/code/repository/capabilities/upload-tarball/README.md`.
 *
 * **Tenant scoping.** Per `ports/CLAUDE.md`, every read/write takes
 * `tenantId` in its method signature so Invariants I7 (tenant isolation)
 * and I9 (cache keys carry tenantId) are enforced at the type level.
 * Each tenant's data lives in that tenant's per-tenant DB; no row spans
 * tenants and there is no cross-tenant escape hatch on the surface.
 *
 * **Why the split into two interfaces.** Phase 1 stores tarball bytes
 * inline as Postgres `BYTEA` alongside the metadata. When the
 * `storage/object-storage` capability lands, the bytes will move to
 * object storage (presigned-URL multipart upload) while metadata stays
 * in the per-tenant relational store. Splitting `RepositoryStore`
 * (metadata only) from `RepositoryRevisionStore` (bytes + revision
 * metadata) lets the revision-store implementation swap to object
 * storage without disturbing the metadata surface or its consumers.
 *
 * Implementations live in `@atlas/adapter-node` (Postgres). The
 * `@atlas/adapter-idb` package ships a throw-stub — push from the
 * browser is not supported.
 */

/**
 * A repository row, exactly as projected to a query consumer. Slugs are
 * caller-normalized kebab-case (e.g. `hello-world`); adapters store and
 * compare exactly the string they're given.
 */
export interface RepositoryRecord {
  /** UUID-shaped, tenant-scoped opaque id. Stable for the life of the repo. */
  repoId: string;
  /** Tenant-unique kebab-case slug. Unique on `(tenantId, repoSlug)`. */
  repoSlug: string;
  /** Human-friendly display name; defaults to the slug if not provided. */
  name: string;
  /** Optional free-text description. `null` when never set. */
  description: string | null;
  /** RFC-3339 timestamp string. */
  createdAt: string;
  /** Principal id (user) that minted the repository. */
  createdBy: string;
}

/**
 * Metadata for a single revision. Bytes are NOT included here — fetch
 * them via `RepositoryRevisionStore.getBytes`. Each `Repository.Uploaded`
 * event mints exactly one revision; revisions are immutable once
 * appended.
 */
export interface RevisionRecord {
  /** UUID-shaped, tenant-scoped opaque id. */
  revisionId: string;
  /** The repository this revision belongs to. */
  repoId: string;
  /** Decoded payload size in bytes. Capped at 10 MB in Phase 1. */
  byteCount: number;
  /** sha256 of the tarball, hex-encoded. Asserted by the upload handler. */
  contentHash: string;
  /** RFC-3339 timestamp string. */
  pushedAt: string;
  /** Principal id (user) that pushed the revision. */
  pushedBy: string;
  /** End-to-end correlation id (Invariant I5) captured from the intent. */
  correlationId: string;
}

/**
 * Tenant-scoped CRUD for repository metadata. Bytes do not flow through
 * this surface — see `RepositoryRevisionStore`.
 */
export interface RepositoryStore {
  /**
   * Look up a repository by its tenant-unique slug. Returns `null` when
   * no row exists for the `(tenantId, repoSlug)` pair. Used by the
   * `Repository.Create` handler to short-circuit when the slug is taken
   * (idempotent re-create returns the existing record), and by
   * `atlasctl repo show <slug>` to resolve a slug to a `repoId`.
   */
  getBySlug(tenantId: string, repoSlug: string): Promise<RepositoryRecord | null>;

  /**
   * Look up a repository by its `repoId`. Returns `null` when no row
   * exists for the `(tenantId, repoId)` pair — including when the id is
   * valid in another tenant (cross-tenant lookups must read as missing).
   */
  get(tenantId: string, repoId: string): Promise<RepositoryRecord | null>;

  /**
   * List every repository the tenant owns. Order is implementation-
   * defined; consumers that care should sort. Used by the
   * `repository_summary` projection rebuild path and by
   * `GET /api/v1/repositories`.
   */
  list(tenantId: string): Promise<readonly RepositoryRecord[]>;

  /**
   * Insert a new repository row. The caller (the `Repository.Create`
   * handler) supplies an already-minted `repoId` so the same id can be
   * referenced in the emitted event without a round-trip.
   *
   * Idempotency lives one level up — the handler dedupes on
   * `(tenantId, repoSlug)` via `getBySlug` before calling `create`. A
   * direct slug collision at the storage layer (UNIQUE constraint on
   * `(tenantId, repoSlug)`) should surface as an error so the bug is
   * loud rather than silently shadowing a row.
   */
  create(
    tenantId: string,
    input: {
      repoId: string;
      repoSlug: string;
      name: string;
      description?: string;
      createdBy: string;
    },
  ): Promise<void>;
}

/**
 * Tenant-scoped store for revision metadata + bytes. Split from
 * `RepositoryStore` so the bytes side can migrate to object-storage in a
 * later capability without disturbing the metadata surface; see the
 * file-level docblock.
 */
export interface RepositoryRevisionStore {
  /**
   * Fetch a single revision's metadata. Returns `null` when no row
   * exists for the `(tenantId, revisionId)` pair — including when the
   * id is valid in another tenant.
   */
  getMetadata(tenantId: string, revisionId: string): Promise<RevisionRecord | null>;

  /**
   * List every revision for a repository, newest-first. Order is part
   * of the contract — the `revision_list` projection and
   * `GET /api/v1/repositories/:repoId/revisions` both rely on it.
   * Returns an empty array when the repo has no revisions yet (or when
   * the repo itself doesn't exist; callers that need to distinguish
   * should `RepositoryStore.get` first).
   */
  listForRepo(tenantId: string, repoId: string): Promise<readonly RevisionRecord[]>;

  /**
   * Fetch the raw tarball bytes for a revision. Returns `null` when no
   * row exists for the `(tenantId, revisionId)` pair. Streams the
   * download route at
   * `GET /api/v1/repositories/:repoId/revisions/:revisionId/bytes`.
   *
   * Phase 1 returns a fully-buffered `Uint8Array` (10 MB cap makes this
   * tolerable). The object-storage migration replaces this signature
   * with a streaming variant; consumers should wrap the call so that
   * change is local.
   */
  getBytes(tenantId: string, revisionId: string): Promise<Uint8Array | null>;

  /**
   * Append a new revision. Atomically writes the metadata row and the
   * bytes; partial writes are not observable.
   *
   * Idempotency lives one level up — the `Repository.Upload` handler
   * dedupes on the standard envelope `idempotencyKey` via the event
   * store before calling `append`. The store itself treats `revisionId`
   * as a primary key; a duplicate id should surface as an error so the
   * bug is loud.
   *
   * `byteCount` MUST equal `bytes.byteLength` and `contentHash` MUST be
   * the sha256 of `bytes` — the handler asserts both before calling.
   * Adapters MAY re-assert as a defense-in-depth check.
   */
  append(
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
  ): Promise<void>;
}
