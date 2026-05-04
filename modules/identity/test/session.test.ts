/**
 * AuthSession handler tests.
 *
 * Covers Issue / Refresh / Revoke / RevokeAllForUser end-to-end against
 * in-memory adapters. Asserts:
 *   - rotation in place (sessionId stable)
 *   - reuse-detection within and outside the grace window
 *   - hard-timeout + idle-timeout enforcement
 *   - concurrent-session eviction (oldest-first)
 *   - I12: dispatcher reproduces post-state from event log
 */

import { describe, it, expect } from 'vitest';
import type {
  EventStore,
  StoredEvent,
  Entity,
  EntityListOptions,
  EntityQueryOptions,
  EntityStatus,
  EntityStore as PortEntityStore,
  EntityWriteInput,
  Relation,
  RelationStore,
  RelationWriteInput,
} from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import {
  handleSessionIssue,
  handleSessionRefresh,
  handleSessionRevoke,
  handleSessionRevokeAllForUser,
  dispatchIdentityEvent,
  getSessionEntity,
  listActiveSessionsForUser,
  IdentityError,
  identityErrorCodes,
  DEFAULT_SESSION_POLICY,
  hashSecret,
  type AuthSessionDocument,
} from '../src/index.ts';

class InMemoryEventStore implements EventStore {
  events: EventEnvelope[] = [];
  private nextSeq = 0n;
  async append(envelope: EventEnvelope): Promise<StoredEvent> {
    this.nextSeq += 1n;
    const stored: StoredEvent = { ...envelope, seq: this.nextSeq };
    this.events.push(stored);
    return stored;
  }
  async getEvent(eventId: string): Promise<EventEnvelope | null> {
    return this.events.find((e) => e.eventId === eventId) ?? null;
  }
  async findByIdempotencyKey(
    tenantId: string,
    idempotencyKey: string,
  ): Promise<EventEnvelope | null> {
    return (
      this.events.find(
        (e) => e.tenantId === tenantId && e.idempotencyKey === idempotencyKey,
      ) ?? null
    );
  }
  async readEvents(): Promise<EventEnvelope[]> {
    return this.events.map((e) => ({ ...e }));
  }
}

class InMemoryEntityStore implements PortEntityStore {
  rows = new Map<string, Entity<unknown>>();
  private k(t: string, ty: string, id: string): string {
    return `${t}::${ty}::${id}`;
  }
  async get<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    entityId: string,
  ): Promise<Entity<TAttrs> | null> {
    const row = this.rows.get(this.k(tenantId, entityType, entityId));
    if (!row || row.status === 'deleted') return null;
    return row as Entity<TAttrs>;
  }
  async put<TAttrs = unknown>(
    input: EntityWriteInput<TAttrs>,
  ): Promise<Entity<TAttrs>> {
    const key = this.k(input.tenantId, input.entityType, input.entityId);
    const existing = this.rows.get(key);
    const now = new Date().toISOString();
    const row: Entity<TAttrs> = {
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      schemaVersion: input.schemaVersion ?? 1,
      attrs: input.attrs,
      status: input.status ?? 'active',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.rows.set(key, row as Entity<unknown>);
    return row;
  }
  async delete(t: string, ty: string, id: string): Promise<void> {
    const key = this.k(t, ty, id);
    const existing = this.rows.get(key);
    if (existing) {
      this.rows.set(key, { ...existing, status: 'deleted' });
    }
  }
  async list<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    opts?: EntityListOptions,
  ): Promise<Entity<TAttrs>[]> {
    const desiredStatus: EntityStatus | null =
      opts?.status === undefined ? 'active' : opts.status;
    return Array.from(this.rows.values())
      .filter((r) => r.tenantId === tenantId && r.entityType === entityType)
      .filter((r) => (desiredStatus === null ? true : r.status === desiredStatus))
      .sort((a, b) => a.entityId.localeCompare(b.entityId)) as Entity<TAttrs>[];
  }
  async query<TAttrs = unknown>(
    tenantId: string,
    entityType: string,
    opts: EntityQueryOptions,
  ): Promise<Entity<TAttrs>[]> {
    // For queries we DELIBERATELY ignore the default status filter
    // and only honor `attrsEqual`. The session handlers query by
    // (userId, status='active'); the in-memory store should only
    // match those rows whose document attrs match — not whose entity
    // row status matches. A revoked session has document.status =
    // 'revoked' AND row.status = 'active' (substrate soft-delete is
    // separate from the domain status); list-active-sessions-for-user
    // must not return revoked sessions.
    const allRows = Array.from(this.rows.values()).filter(
      (r) => r.tenantId === tenantId && r.entityType === entityType,
    );
    if (!opts.attrsEqual) return allRows as Entity<TAttrs>[];
    const predicates = Object.entries(opts.attrsEqual);
    return allRows.filter((row) => {
      const attrs = row.attrs as Record<string, unknown>;
      return predicates.every(([k, v]) => attrs?.[k] === v);
    }) as Entity<TAttrs>[];
  }
}

class InMemoryRelationStore implements RelationStore {
  rows = new Map<string, Relation<unknown>>();
  private k(t: string, e: string, f: string, to: string): string {
    return `${t}::${e}::${f}::${to}`;
  }
  async add<TAttrs = unknown>(
    input: RelationWriteInput<TAttrs>,
  ): Promise<Relation<TAttrs>> {
    const key = this.k(input.tenantId, input.edgeType, input.fromId, input.toId);
    const row: Relation<TAttrs> = {
      tenantId: input.tenantId,
      edgeType: input.edgeType,
      fromId: input.fromId,
      toId: input.toId,
      attrs: input.attrs ?? null,
      createdAt: new Date().toISOString(),
    };
    this.rows.set(key, row as Relation<unknown>);
    return row;
  }
  async remove(t: string, e: string, f: string, to: string): Promise<void> {
    this.rows.delete(this.k(t, e, f, to));
  }
  async outgoing<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    fromId: string,
  ): Promise<Relation<TAttrs>[]> {
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === tenantId && r.edgeType === edgeType && r.fromId === fromId,
    ) as Relation<TAttrs>[];
  }
  async incoming<TAttrs = unknown>(
    tenantId: string,
    edgeType: string,
    toId: string,
  ): Promise<Relation<TAttrs>[]> {
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === tenantId && r.edgeType === edgeType && r.toId === toId,
    ) as Relation<TAttrs>[];
  }
}

interface Fixture {
  events: InMemoryEventStore;
  entities: InMemoryEntityStore;
  relations: InMemoryRelationStore;
  tenantId: string;
}

function newFixture(): Fixture {
  return {
    events: new InMemoryEventStore(),
    entities: new InMemoryEntityStore(),
    relations: new InMemoryRelationStore(),
    tenantId: 't1',
  };
}

async function dispatchAll(fx: Fixture): Promise<void> {
  for (const e of fx.events.events) {
    await dispatchIdentityEvent(e, {
      entities: fx.entities,
      relations: fx.relations,
    });
  }
}

describe('Identity.AuthSession.Issue', () => {
  it('mints session, returns plaintext + cookie payload, persists', async () => {
    const fx = newFixture();
    const result = await handleSessionIssue(
      {
        tenantId: fx.tenantId,
        correlationId: 'c-1',
        principalId: null,
        userId: 'usr-alice',
        ip: '127.0.0.1',
        userAgent: 'test-agent',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.SessionIssued');
    expect(result.plaintextRefreshToken.length).toBeGreaterThan(20);
    expect(result.plaintextAccessToken.length).toBeGreaterThan(20);
    expect(result.cookiePayload).toBe(
      `${result.document.sessionId}.${result.plaintextRefreshToken}`,
    );
    expect(result.document.refreshTokenHash).toBe(hashSecret(result.plaintextRefreshToken));
    expect(result.document.status).toBe('active');
    expect(result.document.ip).toBe('127.0.0.1');

    await dispatchAll(fx);
    const stored = await getSessionEntity(fx.entities, fx.tenantId, result.document.sessionId);
    expect(stored?.status).toBe('active');
  });

  it('evicts oldest session when at concurrent-cap', async () => {
    const fx = newFixture();
    const policy = { ...DEFAULT_SESSION_POLICY, maxConcurrentSessions: 2 };
    const first = await handleSessionIssue(
      { tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice', policy },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    // Force a tiny delay so issuedAt timestamps differ deterministically.
    await new Promise((r) => setTimeout(r, 5));
    const second = await handleSessionIssue(
      { tenantId: fx.tenantId, correlationId: 'c2', principalId: null, userId: 'usr-alice', policy },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    await new Promise((r) => setTimeout(r, 5));
    const third = await handleSessionIssue(
      { tenantId: fx.tenantId, correlationId: 'c3', principalId: null, userId: 'usr-alice', policy },
      fx.events,
      fx.entities,
    );
    expect(third.follow.map((e) => e.eventType)).toEqual(['Identity.SessionEnded']);
    const evictedPayload = third.follow[0]?.payload as Record<string, unknown>;
    expect(evictedPayload['reason']).toBe('evicted');
    await dispatchAll(fx);

    // After eviction: only 2 active sessions for the user — the one
    // we just issued + the second. The first was evicted.
    const active = await listActiveSessionsForUser(fx.entities, fx.tenantId, 'usr-alice');
    expect(active.map((s) => s.sessionId).sort()).toEqual(
      [second.document.sessionId, third.document.sessionId].sort(),
    );
    const evictedRow = await getSessionEntity(fx.entities, fx.tenantId, first.document.sessionId);
    expect(evictedRow?.status).toBe('evicted');
  });
});

describe('Identity.AuthSession.Refresh', () => {
  it('rotates tokens; sessionId stable; previousRefreshTokenHash set', async () => {
    const fx = newFixture();
    const issued = await handleSessionIssue(
      { tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice' },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);

    const refreshed = await handleSessionRefresh(
      {
        tenantId: fx.tenantId,
        correlationId: 'c2',
        sessionId: issued.document.sessionId,
        presentedRefreshSecret: issued.plaintextRefreshToken,
      },
      fx.events,
      fx.entities,
    );
    expect(refreshed.envelope.eventType).toBe('Identity.SessionRefreshed');
    expect(refreshed.document?.sessionId).toBe(issued.document.sessionId);
    expect(refreshed.document?.refreshTokenHash).not.toBe(
      issued.document.refreshTokenHash,
    );
    expect(refreshed.document?.previousRefreshTokenHash).toBe(
      issued.document.refreshTokenHash,
    );
    expect(refreshed.plaintextRefreshToken).not.toBe(issued.plaintextRefreshToken);
  });

  it('rejects unknown sessionId with SESSION_NOT_FOUND', async () => {
    const fx = newFixture();
    await expect(
      handleSessionRefresh(
        {
          tenantId: fx.tenantId,
          correlationId: 'c',
          sessionId: 'ses-nope',
          presentedRefreshSecret: 'whatever',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SESSION_NOT_FOUND });
  });

  it('rejects wrong refresh secret with SESSION_NOT_FOUND (no leak)', async () => {
    const fx = newFixture();
    const issued = await handleSessionIssue(
      { tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice' },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    await expect(
      handleSessionRefresh(
        {
          tenantId: fx.tenantId,
          correlationId: 'c2',
          sessionId: issued.document.sessionId,
          presentedRefreshSecret: 'wrong-secret-totally-not-the-real-one-aaaa',
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SESSION_NOT_FOUND });
  });

  it('reuse OUTSIDE grace triggers RevokeAllForUser + SessionAnomaly', async () => {
    const fx = newFixture();
    const policy = { ...DEFAULT_SESSION_POLICY, refreshGraceSeconds: 0 };
    const issued = await handleSessionIssue(
      { tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice', policy },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    // First refresh succeeds.
    await handleSessionRefresh(
      {
        tenantId: fx.tenantId,
        correlationId: 'c2',
        sessionId: issued.document.sessionId,
        presentedRefreshSecret: issued.plaintextRefreshToken,
        policy,
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    // Second issue: another active session for the same user (the one
    // about to be defensively revoked alongside the original).
    const sibling = await handleSessionIssue(
      { tenantId: fx.tenantId, correlationId: 'c3', principalId: null, userId: 'usr-alice', policy },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    // Replay the OLD plaintext (now stale). With grace=0, this falls
    // outside the window immediately and should trigger reuse-detection.
    await new Promise((r) => setTimeout(r, 10));
    let caught: unknown;
    try {
      await handleSessionRefresh(
        {
          tenantId: fx.tenantId,
          correlationId: 'c4',
          sessionId: issued.document.sessionId,
          presentedRefreshSecret: issued.plaintextRefreshToken,
          policy,
        },
        fx.events,
        fx.entities,
      );
    } catch (e) {
      caught = e;
    }
    expect((caught as IdentityError | undefined)?.code).toBe(
      identityErrorCodes.SESSION_REUSE_DETECTED,
    );
    await dispatchAll(fx);
    // Both sessions revoked, plus an anomaly event in the log.
    const original = await getSessionEntity(
      fx.entities,
      fx.tenantId,
      issued.document.sessionId,
    );
    const siblingNow = await getSessionEntity(
      fx.entities,
      fx.tenantId,
      sibling.document.sessionId,
    );
    expect(original?.status).toBe('revoked');
    expect(original?.endReason).toBe('reuse_detected');
    expect(siblingNow?.status).toBe('revoked');
    const anomalies = fx.events.events.filter(
      (e) => e.eventType === 'Identity.SessionAnomaly',
    );
    expect(anomalies.length).toBe(1);
  });

  it('reuse INSIDE grace rotates again (network blip recovery)', async () => {
    const fx = newFixture();
    const policy = { ...DEFAULT_SESSION_POLICY, refreshGraceSeconds: 60 };
    const issued = await handleSessionIssue(
      { tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice', policy },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    const first = await handleSessionRefresh(
      {
        tenantId: fx.tenantId,
        correlationId: 'c2',
        sessionId: issued.document.sessionId,
        presentedRefreshSecret: issued.plaintextRefreshToken,
        policy,
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    // Client retries with the original (now-previous) token. Should
    // succeed because we're well within the 60s grace.
    const second = await handleSessionRefresh(
      {
        tenantId: fx.tenantId,
        correlationId: 'c3',
        sessionId: issued.document.sessionId,
        presentedRefreshSecret: issued.plaintextRefreshToken,
        policy,
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    expect(second.envelope.eventType).toBe('Identity.SessionRefreshed');
    expect(second.document?.sessionId).toBe(issued.document.sessionId);
    // The "new previous" is now the first-rotation hash — not the
    // original. The client gets fresh plaintexts on this branch too.
    expect(second.document?.previousRefreshTokenHash).toBe(
      first.document?.refreshTokenHash,
    );
  });

  it('hard-timeout flips to expired and rejects', async () => {
    const fx = newFixture();
    const issued = await handleSessionIssue(
      { tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice' },
      fx.events,
      fx.entities,
    );
    // Force the session past hardExpiresAt.
    await dispatchAll(fx);
    const past = new Date(Date.now() - 1_000).toISOString();
    await fx.entities.put({
      tenantId: fx.tenantId,
      entityType: 'AuthSession',
      entityId: issued.document.sessionId,
      attrs: { ...issued.document, hardExpiresAt: past } as AuthSessionDocument,
      schemaVersion: 1,
    });
    await expect(
      handleSessionRefresh(
        {
          tenantId: fx.tenantId,
          correlationId: 'c2',
          sessionId: issued.document.sessionId,
          presentedRefreshSecret: issued.plaintextRefreshToken,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SESSION_HARD_TIMEOUT });
  });

  it('idle-timeout rejects when lastSeenAt is too old', async () => {
    const fx = newFixture();
    const policy = { ...DEFAULT_SESSION_POLICY, idleTimeoutMinutes: 1 };
    const issued = await handleSessionIssue(
      { tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice', policy },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await fx.entities.put({
      tenantId: fx.tenantId,
      entityType: 'AuthSession',
      entityId: issued.document.sessionId,
      attrs: { ...issued.document, lastSeenAt: stale } as AuthSessionDocument,
      schemaVersion: 1,
    });
    await expect(
      handleSessionRefresh(
        {
          tenantId: fx.tenantId,
          correlationId: 'c2',
          sessionId: issued.document.sessionId,
          presentedRefreshSecret: issued.plaintextRefreshToken,
          policy,
        },
        fx.events,
        fx.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SESSION_IDLE_TIMEOUT });
  });
});

describe('Identity.AuthSession.Revoke', () => {
  it('flips status to revoked, records reason', async () => {
    const fx = newFixture();
    const issued = await handleSessionIssue(
      { tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice' },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    const result = await handleSessionRevoke(
      {
        tenantId: fx.tenantId,
        correlationId: 'c2',
        principalId: 'usr-alice',
        sessionId: issued.document.sessionId,
        reason: 'user_logout',
      },
      fx.events,
      fx.entities,
    );
    expect(result.document.status).toBe('revoked');
    expect(result.document.endReason).toBe('user_logout');
    await dispatchAll(fx);
    const stored = await getSessionEntity(
      fx.entities,
      fx.tenantId,
      issued.document.sessionId,
    );
    expect(stored?.status).toBe('revoked');
  });
});

describe('Identity.AuthSession.RevokeAllForUser', () => {
  it('emits SessionEnded per active session, returns ids', async () => {
    const fx = newFixture();
    await handleSessionIssue(
      { tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice' },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    await handleSessionIssue(
      { tenantId: fx.tenantId, correlationId: 'c2', principalId: null, userId: 'usr-alice' },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    const result = await handleSessionRevokeAllForUser(
      {
        tenantId: fx.tenantId,
        correlationId: 'c3',
        principalId: null,
        userId: 'usr-alice',
        reason: 'password_changed',
      },
      fx.events,
      fx.entities,
    );
    expect(result.envelopes.length).toBe(2);
    expect(result.revokedSessionIds.length).toBe(2);
    await dispatchAll(fx);
    const active = await listActiveSessionsForUser(
      fx.entities,
      fx.tenantId,
      'usr-alice',
    );
    expect(active).toHaveLength(0);
  });
});

describe('I12 — sessions replay from event log alone', () => {
  it('full Issue + Refresh + Revoke chain reproduces post-state', async () => {
    const fx = newFixture();
    const issued = await handleSessionIssue(
      { tenantId: fx.tenantId, correlationId: 'c1', principalId: null, userId: 'usr-alice' },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    await handleSessionRefresh(
      {
        tenantId: fx.tenantId,
        correlationId: 'c2',
        sessionId: issued.document.sessionId,
        presentedRefreshSecret: issued.plaintextRefreshToken,
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);
    await handleSessionRevoke(
      {
        tenantId: fx.tenantId,
        correlationId: 'c3',
        principalId: 'usr-alice',
        sessionId: issued.document.sessionId,
        reason: 'user_logout',
      },
      fx.events,
      fx.entities,
    );
    await dispatchAll(fx);

    function strip(s: string): string {
      return s
        .replace(/"updatedAt":"[^"]+"/g, '"updatedAt":"<t>"')
        .replace(/"createdAt":"[^"]+"/g, '"createdAt":"<t>"');
    }
    const before = strip(
      JSON.stringify(Array.from(fx.entities.rows.entries()).sort()),
    );
    fx.entities.rows.clear();
    fx.relations.rows.clear();
    await dispatchAll(fx);
    const after = strip(
      JSON.stringify(Array.from(fx.entities.rows.entries()).sort()),
    );
    expect(before).toBe(after);
  });
});
