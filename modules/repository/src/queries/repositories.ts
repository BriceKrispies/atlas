/**
 * Read-side query helpers for the repository module.
 *
 * Reads come directly from the `RepositoryStore` + `RepositoryRevisionStore`
 * canonical surfaces — the per-tenant Postgres tables ARE the projection
 * for this slice (see the upload-tarball capability spec, "Surfaces" →
 * "Migrations"). Queries NEVER read from the event store directly.
 *
 * **Two query-deps shapes** — the route layer is split per endpoint:
 *
 *   - `RepositoryReadDeps` — only needs `repositories`. Used by
 *     `getRepository`, `listRepositories`, and the route's existence
 *     check before serving revision-list / bytes.
 *   - `RepositoryRevisionReadDeps` — only needs `revisions`. Used by
 *     `getRevision` and `listRevisions`.
 *
 * Splitting the deps keeps each route function a thin shim over the
 * port it actually consumes — no over-supplying a `projections` store
 * the call doesn't need.
 *
 * Tenant scoping: every query takes `tenantId` in its deps. The route
 * layer constructs deps per-request from the resolved principal/tenant.
 */

import type {
  RepositoryStore,
  RepositoryRevisionStore,
  RepositoryRecord,
  RevisionRecord,
} from '@atlas/ports';

export interface RepositoryReadDeps {
  tenantId: string;
  repositories: RepositoryStore;
}

export interface RepositoryRevisionReadDeps {
  tenantId: string;
  revisions: RepositoryRevisionStore;
}

export async function getRepository(
  deps: RepositoryReadDeps,
  repoId: string,
): Promise<RepositoryRecord | null> {
  return deps.repositories.get(deps.tenantId, repoId);
}

export async function listRepositories(
  deps: RepositoryReadDeps,
): Promise<readonly RepositoryRecord[]> {
  return deps.repositories.list(deps.tenantId);
}

export async function getRevision(
  deps: RepositoryRevisionReadDeps,
  revisionId: string,
): Promise<RevisionRecord | null> {
  return deps.revisions.getMetadata(deps.tenantId, revisionId);
}

/**
 * List a repo's revisions newest-first. Reads directly from
 * `RepositoryRevisionStore.listForRepo` — order is part of that
 * port's contract.
 */
export async function listRevisions(
  deps: RepositoryRevisionReadDeps,
  repoId: string,
): Promise<readonly RevisionRecord[]> {
  return deps.revisions.listForRepo(deps.tenantId, repoId);
}
