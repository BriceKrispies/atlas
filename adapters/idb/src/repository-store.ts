/**
 * IdbRepositoryStore / IdbRepositoryRevisionStore — server-only stub.
 *
 * RepositoryStore is server-only — sim/IDB does not support push. The
 * adapter exists only so that contract-test factories can construct an
 * instance for the negative-skip pattern (the IDB suite is marked
 * expected-to-throw rather than running the round-trip).
 *
 * See `specs/domains/code/repository/capabilities/upload-tarball/README.md`
 * for the rationale: tarball bytes flow through the server's per-tenant
 * Postgres BYTEA storage today, with a planned migration to object-storage.
 * Browser-side push has no on-path use case.
 */

import type {
  RepositoryRecord,
  RepositoryRevisionStore,
  RepositoryStore,
  RevisionRecord,
} from '@atlas/ports';

const SERVER_ONLY_MESSAGE =
  'RepositoryStore is server-only — push from the browser is not supported. ' +
  'See specs/domains/code/repository/capabilities/upload-tarball/README.md';

export class IdbRepositoryStore implements RepositoryStore {
  async getBySlug(_tenantId: string, _repoSlug: string): Promise<RepositoryRecord | null> {
    throw new Error(SERVER_ONLY_MESSAGE);
  }

  async get(_tenantId: string, _repoId: string): Promise<RepositoryRecord | null> {
    throw new Error(SERVER_ONLY_MESSAGE);
  }

  async list(_tenantId: string): Promise<readonly RepositoryRecord[]> {
    throw new Error(SERVER_ONLY_MESSAGE);
  }

  async create(
    _tenantId: string,
    _input: {
      repoId: string;
      repoSlug: string;
      name: string;
      description?: string | null;
      createdBy: string;
    },
  ): Promise<void> {
    throw new Error(SERVER_ONLY_MESSAGE);
  }
}

export class IdbRepositoryRevisionStore implements RepositoryRevisionStore {
  async getMetadata(_tenantId: string, _revisionId: string): Promise<RevisionRecord | null> {
    throw new Error(SERVER_ONLY_MESSAGE);
  }

  async listForRepo(_tenantId: string, _repoId: string): Promise<readonly RevisionRecord[]> {
    throw new Error(SERVER_ONLY_MESSAGE);
  }

  async getBytes(_tenantId: string, _revisionId: string): Promise<Uint8Array | null> {
    throw new Error(SERVER_ONLY_MESSAGE);
  }

  async append(
    _tenantId: string,
    _input: {
      revisionId: string;
      repoId: string;
      bytes: Uint8Array;
      byteCount: number;
      contentHash: string;
      pushedBy: string;
      correlationId: string;
    },
  ): Promise<void> {
    throw new Error(SERVER_ONLY_MESSAGE);
  }
}
