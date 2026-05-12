/**
 * Repository dispatcher I12 enforcement test.
 *
 * Replays the synthetic event stream `[Created, Uploaded, Uploaded]`
 * against fresh in-memory `RepositoryStore` + `RepositoryRevisionStore`
 * implementations via `repositoryDispatcher` and asserts the resulting
 * canonical state matches the in-line dispatch path. This is the
 * canonical I12 test: projections (the canonical metadata stores) are
 * derivable from the event stream alone, so a worker rebuild from
 * event history must match a write-time-dispatched store.
 *
 * Note: revision **bytes** are not on the event payload — the rebuild
 * recovers metadata only. That mirrors the spec's split between
 * `RepositoryStore` (fully event-derivable) and
 * `RepositoryRevisionStore` (bytes durable but not event-derived).
 */

import { describe, it, expect } from 'vitest';
import type { EventEnvelope } from '@atlas/platform-core';
import type {
  RepositoryRecord,
  RepositoryRevisionStore,
  RepositoryStore,
  RevisionRecord,
} from '@atlas/ports';
import {
  REPOSITORY_CREATED_EVENT_TYPE,
  REPOSITORY_CREATED_SCHEMA_ID,
  REPOSITORY_CREATED_SCHEMA_VERSION,
  REPOSITORY_UPLOADED_EVENT_TYPE,
  REPOSITORY_UPLOADED_SCHEMA_ID,
  REPOSITORY_UPLOADED_SCHEMA_VERSION,
  repositoryDispatcher,
} from '../src/index.ts';

class InMemoryRepositoryStore implements RepositoryStore {
  rows = new Map<string, RepositoryRecord>();

  private k(tenantId: string, repoId: string): string {
    return `${tenantId}::${repoId}`;
  }

  async getBySlug(
    tenantId: string,
    repoSlug: string,
  ): Promise<RepositoryRecord | null> {
    for (const [key, r] of this.rows) {
      if (key.startsWith(`${tenantId}::`) && r.repoSlug === repoSlug) {
        return { ...r };
      }
    }
    return null;
  }

  async get(
    tenantId: string,
    repoId: string,
  ): Promise<RepositoryRecord | null> {
    const r = this.rows.get(this.k(tenantId, repoId));
    return r ? { ...r } : null;
  }

  async list(tenantId: string): Promise<readonly RepositoryRecord[]> {
    const out: RepositoryRecord[] = [];
    for (const [key, r] of this.rows) {
      if (key.startsWith(`${tenantId}::`)) out.push({ ...r });
    }
    return out;
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
    const key = this.k(tenantId, input.repoId);
    if (this.rows.has(key)) {
      throw new Error(`repo ${input.repoId} already exists`);
    }
    this.rows.set(key, {
      repoId: input.repoId,
      repoSlug: input.repoSlug,
      name: input.name,
      description: input.description ?? null,
      createdAt: '2026-05-08T00:00:00.000Z',
      createdBy: input.createdBy,
    });
  }

  /** Test-only: dump rows in a deterministic comparable shape. */
  snapshot(): RepositoryRecord[] {
    return Array.from(this.rows.values())
      .map((r) => ({ ...r }))
      .sort((a, b) => a.repoId.localeCompare(b.repoId));
  }
}

class InMemoryRepositoryRevisionStore implements RepositoryRevisionStore {
  metadata = new Map<string, RevisionRecord>();
  bytes = new Map<string, Uint8Array>();

  private k(tenantId: string, revisionId: string): string {
    return `${tenantId}::${revisionId}`;
  }

  async getMetadata(
    tenantId: string,
    revisionId: string,
  ): Promise<RevisionRecord | null> {
    const r = this.metadata.get(this.k(tenantId, revisionId));
    return r ? { ...r } : null;
  }

  async listForRepo(
    tenantId: string,
    repoId: string,
  ): Promise<readonly RevisionRecord[]> {
    const out: RevisionRecord[] = [];
    for (const [key, r] of this.metadata) {
      if (key.startsWith(`${tenantId}::`) && r.repoId === repoId) {
        out.push({ ...r });
      }
    }
    return out.sort((a, b) => (a.pushedAt < b.pushedAt ? 1 : -1));
  }

  async getBytes(
    tenantId: string,
    revisionId: string,
  ): Promise<Uint8Array | null> {
    const b = this.bytes.get(this.k(tenantId, revisionId));
    return b ? new Uint8Array(b) : null;
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
    const key = this.k(tenantId, input.revisionId);
    if (this.metadata.has(key)) {
      throw new Error(`revision ${input.revisionId} already exists`);
    }
    this.metadata.set(key, {
      revisionId: input.revisionId,
      repoId: input.repoId,
      byteCount: input.byteCount,
      contentHash: input.contentHash,
      pushedAt: '2026-05-08T00:00:00.000Z',
      pushedBy: input.pushedBy,
      correlationId: input.correlationId,
    });
    this.bytes.set(key, new Uint8Array(input.bytes));
  }

  /** Test-only: dump metadata rows in a deterministic comparable shape. */
  snapshot(): RevisionRecord[] {
    return Array.from(this.metadata.values())
      .map((r) => ({ ...r }))
      .sort((a, b) => a.revisionId.localeCompare(b.revisionId));
  }
}

function makeCreatedEnvelope(opts: {
  tenantId: string;
  repoId: string;
  repoSlug: string;
  name: string;
  description: string | null;
  occurredAt: string;
  principalId: string;
  correlationId: string;
}): EventEnvelope {
  return {
    eventId: `event-created-${opts.repoId}`,
    eventType: REPOSITORY_CREATED_EVENT_TYPE,
    schemaId: REPOSITORY_CREATED_SCHEMA_ID,
    schemaVersion: REPOSITORY_CREATED_SCHEMA_VERSION,
    occurredAt: opts.occurredAt,
    tenantId: opts.tenantId,
    correlationId: opts.correlationId,
    idempotencyKey: `repository.create.${opts.tenantId}.${opts.repoSlug}`,
    causationId: null,
    principalId: opts.principalId,
    userId: opts.principalId,
    cacheInvalidationTags: [
      `Tenant:${opts.tenantId}`,
      `Repository:${opts.repoId}`,
    ],
    payload: {
      repoId: opts.repoId,
      repoSlug: opts.repoSlug,
      name: opts.name,
      description: opts.description,
    },
  };
}

function makeUploadedEnvelope(opts: {
  tenantId: string;
  repoId: string;
  revisionId: string;
  byteCount: number;
  contentHash: string;
  occurredAt: string;
  principalId: string;
  correlationId: string;
}): EventEnvelope {
  return {
    eventId: `event-uploaded-${opts.revisionId}`,
    eventType: REPOSITORY_UPLOADED_EVENT_TYPE,
    schemaId: REPOSITORY_UPLOADED_SCHEMA_ID,
    schemaVersion: REPOSITORY_UPLOADED_SCHEMA_VERSION,
    occurredAt: opts.occurredAt,
    tenantId: opts.tenantId,
    correlationId: opts.correlationId,
    idempotencyKey: `repository.upload.${opts.tenantId}.${opts.revisionId}`,
    causationId: null,
    principalId: opts.principalId,
    userId: opts.principalId,
    cacheInvalidationTags: [
      `Tenant:${opts.tenantId}`,
      `Repository:${opts.repoId}`,
      `Revision:${opts.revisionId}`,
    ],
    payload: {
      repoId: opts.repoId,
      revisionId: opts.revisionId,
      byteCount: opts.byteCount,
      contentHash: opts.contentHash,
      pushedBy: opts.principalId,
    },
  };
}

describe('repositoryDispatcher (I12)', () => {
  it('replays [Created, Uploaded, Uploaded] producing the same canonical state as the in-line path', async () => {
    const tenantId = 'acme';
    const repoId = 'repo-test-1';
    const stream: EventEnvelope[] = [
      makeCreatedEnvelope({
        tenantId,
        repoId,
        repoSlug: 'hello-world',
        name: 'hello-world',
        description: null,
        occurredAt: '2026-05-08T10:00:00.000Z',
        principalId: 'user-1',
        correlationId: 'corr-create',
      }),
      makeUploadedEnvelope({
        tenantId,
        repoId,
        revisionId: 'rev-1',
        byteCount: 100,
        contentHash: 'a'.repeat(64),
        occurredAt: '2026-05-08T10:05:00.000Z',
        principalId: 'user-1',
        correlationId: 'corr-up-1',
      }),
      makeUploadedEnvelope({
        tenantId,
        repoId,
        revisionId: 'rev-2',
        byteCount: 250,
        contentHash: 'b'.repeat(64),
        occurredAt: '2026-05-08T10:10:00.000Z',
        principalId: 'user-2',
        correlationId: 'corr-up-2',
      }),
    ];

    // Pass A — in-line dispatch (mirrors a write-time fanout where the
    // handler had not pre-populated the stores; the dispatcher
    // materializes everything).
    const inlineRepos = new InMemoryRepositoryStore();
    const inlineRevs = new InMemoryRepositoryRevisionStore();
    const inlineDispatch = repositoryDispatcher({
      repositories: inlineRepos,
      revisions: inlineRevs,
    });
    for (const env of stream) {
      await inlineDispatch(env);
    }

    // Pass B — replay through the same dispatcher into a fresh pair.
    const replayRepos = new InMemoryRepositoryStore();
    const replayRevs = new InMemoryRepositoryRevisionStore();
    const replayDispatch = repositoryDispatcher({
      repositories: replayRepos,
      revisions: replayRevs,
    });
    for (const env of stream) {
      await replayDispatch(env);
    }

    // Snapshots must be identical.
    expect(replayRepos.snapshot()).toEqual(inlineRepos.snapshot());
    expect(replayRevs.snapshot()).toEqual(inlineRevs.snapshot());

    // And the rebuilt state is correct.
    const repos = inlineRepos.snapshot();
    expect(repos).toHaveLength(1);
    const [repo] = repos;
    if (!repo) throw new Error('expected one repo after dispatch');
    expect(repo).toMatchObject({
      repoId,
      repoSlug: 'hello-world',
      name: 'hello-world',
      description: null,
      createdBy: 'user-1',
    });
    const revs = inlineRevs.snapshot();
    expect(revs).toHaveLength(2);
    const revIds = revs.map((r) => r.revisionId).sort();
    expect(revIds).toEqual(['rev-1', 'rev-2']);
    const rev1 = revs.find((r) => r.revisionId === 'rev-1');
    const rev2 = revs.find((r) => r.revisionId === 'rev-2');
    if (!rev1 || !rev2) throw new Error('expected rev-1 and rev-2 after dispatch');
    expect(rev1.byteCount).toBe(100);
    expect(rev2.byteCount).toBe(250);
  });

  it('is idempotent on re-dispatch (a second pass does not double-write)', async () => {
    const tenantId = 'acme';
    const repoId = 'repo-idempotent';
    const stream: EventEnvelope[] = [
      makeCreatedEnvelope({
        tenantId,
        repoId,
        repoSlug: 'idem',
        name: 'idem',
        description: null,
        occurredAt: '2026-05-08T10:00:00.000Z',
        principalId: 'user-1',
        correlationId: 'corr-create',
      }),
      makeUploadedEnvelope({
        tenantId,
        repoId,
        revisionId: 'rev-1',
        byteCount: 50,
        contentHash: 'c'.repeat(64),
        occurredAt: '2026-05-08T10:05:00.000Z',
        principalId: 'user-1',
        correlationId: 'corr-up-1',
      }),
    ];

    const repos = new InMemoryRepositoryStore();
    const revs = new InMemoryRepositoryRevisionStore();
    const dispatch = repositoryDispatcher({
      repositories: repos,
      revisions: revs,
    });

    for (const env of stream) await dispatch(env);
    const after1 = {
      repos: repos.snapshot(),
      revs: revs.snapshot(),
    };

    // Replay the same stream — must not throw, must not duplicate.
    for (const env of stream) await dispatch(env);
    const after2 = {
      repos: repos.snapshot(),
      revs: revs.snapshot(),
    };

    expect(after2).toEqual(after1);
    expect(after2.repos).toHaveLength(1);
    expect(after2.revs).toHaveLength(1);
  });

  it('ignores events outside the repository event-type set', async () => {
    const repos = new InMemoryRepositoryStore();
    const revs = new InMemoryRepositoryRevisionStore();
    const dispatch = repositoryDispatcher({
      repositories: repos,
      revisions: revs,
    });
    const unrelated: EventEnvelope = {
      eventId: 'e-other',
      eventType: 'StructuredCatalog.SeedPackageApplied',
      schemaId: 'catalog.seed_package_applied.v1',
      schemaVersion: 1,
      occurredAt: '2026-05-08T00:00:00Z',
      tenantId: 'acme',
      correlationId: 'corr',
      idempotencyKey: 'k',
      payload: {},
    };
    await dispatch(unrelated);
    expect(repos.snapshot()).toHaveLength(0);
    expect(revs.snapshot()).toHaveLength(0);
  });
});
