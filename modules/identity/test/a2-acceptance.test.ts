/**
 * Phase A2 acceptance — end-to-end integration tests.
 *
 * Covers the `@phase-a2`-tagged scenarios across the three Phase A1
 * feature files plus every Phase-A2-native scenario in
 * `api-key.feature`, `service-principal-oauth.feature`, and
 * `session-management.feature`.
 *
 * Each `it(...)` cites the Gherkin scenario it implements. Updates to
 * a scenario should land here in lockstep so the @phase-a2 set stays
 * truthful.
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
  handleApiKeyCreate,
  handleApiKeyRevoke,
  handleApiKeyRotate,
  handleInviteAccept,
  handleInviteIssue,
  handleOAuthIssueToken,
  handleOAuthRevokeToken,
  handlePasswordLogin,
  handlePasswordSet,
  handleServicePrincipalCreate,
  handleServicePrincipalDisable,
  handleSessionRefresh,
  handleSessionRevokeAllForUser,
  dispatchIdentityEvent,
  getApiKeyEntity,
  getOAuthTokenEntity,
  getServicePrincipalEntity,
  getSessionEntity,
  IdentityError,
  identityErrorCodes,
  parseApiKeyBearer,
  type ApiKeyDocument,
  type AuthSessionDocument,
  type OAuthAccessTokenDocument,
} from '../src/index.ts';
import { assertEventTags } from './lib/fixtures.ts';

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
  async get<T = unknown>(
    tenantId: string,
    entityType: string,
    entityId: string,
  ): Promise<Entity<T> | null> {
    const row = this.rows.get(this.k(tenantId, entityType, entityId));
    if (!row || row.status === 'deleted') return null;
    return row as Entity<T>;
  }
  async put<T = unknown>(input: EntityWriteInput<T>): Promise<Entity<T>> {
    const key = this.k(input.tenantId, input.entityType, input.entityId);
    const existing = this.rows.get(key);
    const now = new Date().toISOString();
    const row: Entity<T> = {
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
    if (existing) this.rows.set(key, { ...existing, status: 'deleted' });
  }
  async list<T = unknown>(
    tenantId: string,
    entityType: string,
    opts?: EntityListOptions,
  ): Promise<Entity<T>[]> {
    const desired: EntityStatus | null =
      opts?.status === undefined ? 'active' : opts.status;
    return Array.from(this.rows.values())
      .filter((r) => r.tenantId === tenantId && r.entityType === entityType)
      .filter((r) => (desired === null ? true : r.status === desired)) as Entity<T>[];
  }
  async query<T = unknown>(
    tenantId: string,
    entityType: string,
    opts: EntityQueryOptions,
  ): Promise<Entity<T>[]> {
    const all = Array.from(this.rows.values()).filter(
      (r) => r.tenantId === tenantId && r.entityType === entityType,
    );
    if (!opts.attrsEqual) return all as Entity<T>[];
    const preds = Object.entries(opts.attrsEqual);
    return all.filter((row) => {
      const attrs = row.attrs as Record<string, unknown>;
      return preds.every(([k, v]) => attrs?.[k] === v);
    }) as Entity<T>[];
  }
}

class InMemoryRelationStore implements RelationStore {
  rows = new Map<string, Relation<unknown>>();
  private k(t: string, e: string, f: string, to: string): string {
    return `${t}::${e}::${f}::${to}`;
  }
  async add<T = unknown>(input: RelationWriteInput<T>): Promise<Relation<T>> {
    const key = this.k(input.tenantId, input.edgeType, input.fromId, input.toId);
    const row: Relation<T> = {
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
  async outgoing<T = unknown>(t: string, e: string, f: string): Promise<Relation<T>[]> {
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === t && r.edgeType === e && r.fromId === f,
    ) as Relation<T>[];
  }
  async incoming<T = unknown>(t: string, e: string, to: string): Promise<Relation<T>[]> {
    return Array.from(this.rows.values()).filter(
      (r) => r.tenantId === t && r.edgeType === e && r.toId === to,
    ) as Relation<T>[];
  }
}

interface Fx {
  events: InMemoryEventStore;
  entities: InMemoryEntityStore;
  relations: InMemoryRelationStore;
  tenantId: string;
}
function fx(): Fx {
  return {
    events: new InMemoryEventStore(),
    entities: new InMemoryEntityStore(),
    relations: new InMemoryRelationStore(),
    tenantId: 't1',
  };
}
async function dispatchAll(f: Fx): Promise<void> {
  for (const e of f.events.events) {
    await dispatchIdentityEvent(e, { entities: f.entities, relations: f.relations });
  }
}

async function bootstrapUserWithSession(
  f: Fx,
  email: string,
  password: string,
): Promise<{
  userId: string;
  sessionId: string;
  refreshSecret: string;
  accessSecret: string;
}> {
  const issued = await handleInviteIssue(
    {
      tenantId: f.tenantId,
      correlationId: 'c-i',
      principalId: '_boot',
      email,
      rolesOnAccept: ['TenantAdmin'],
    },
    f.events,
  );
  await dispatchAll(f);
  const accept = await handleInviteAccept(
    {
      tenantId: f.tenantId,
      correlationId: 'c-a',
      principalId: null,
      presentedToken: issued.plaintextToken,
      acceptedEmail: email,
    },
    f.events,
    f.entities,
  );
  await dispatchAll(f);
  // SetPassword fires `RevokeAllForUser` (session-fixation defense) so
  // the session minted during `invite-accept` is now revoked. Log back
  // in via password to mint a fresh session that subsequent tests can
  // use.
  await handlePasswordSet(
    {
      tenantId: f.tenantId,
      correlationId: 'c-s',
      principalId: accept.user.userId,
      userId: accept.user.userId,
      newPassword: password,
    },
    f.events,
    f.entities,
  );
  await dispatchAll(f);
  const login = await handlePasswordLogin(
    {
      tenantId: f.tenantId,
      correlationId: 'c-relogin',
      email,
      password,
    },
    f.events,
    f.entities,
  );
  await dispatchAll(f);
  if (!login.sessionResult) throw new Error('expected session from re-login');
  return {
    userId: accept.user.userId,
    sessionId: login.sessionResult.document.sessionId,
    refreshSecret: login.sessionResult.plaintextRefreshToken,
    accessSecret: login.sessionResult.plaintextAccessToken,
  };
}

// =====================================================================
// session-management.feature
// =====================================================================

describe('session-management.feature: refresh-token rotation', () => {
  it('rotation issues new tokens and invalidates the old refresh', async () => {
    const f = fx();
    const boot = await bootstrapUserWithSession(f, 'alice@t1.com', 'correct-horse-Battery-staple');
    const refreshed = await handleSessionRefresh(
      {
        tenantId: f.tenantId,
        correlationId: 'c-r',
        sessionId: boot.sessionId,
        presentedRefreshSecret: boot.refreshSecret,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    expect(refreshed.envelope.eventType).toBe('Identity.SessionRefreshed');
    expect(refreshed.plaintextRefreshToken).not.toBe(boot.refreshSecret);
    expect(refreshed.document?.sessionId).toBe(boot.sessionId);
    // I10 — primary session-refresh emit must tag the tenant + session.
    assertEventTags(refreshed.envelope, [
      `Tenant:${f.tenantId}`,
      `Session:${boot.sessionId}`,
    ]);
  });
});

describe('session-management.feature: refresh-token reuse breach', () => {
  it('replay of stale refresh outside grace revokes ALL sessions', async () => {
    const f = fx();
    const boot = await bootstrapUserWithSession(f, 'alice@t1.com', 'correct-horse-Battery-staple');
    // Force grace=0 so the first replay trips reuse-detection.
    await handleSessionRefresh(
      {
        tenantId: f.tenantId,
        correlationId: 'c-r',
        sessionId: boot.sessionId,
        presentedRefreshSecret: boot.refreshSecret,
        policy: {
          maxConcurrentSessions: 10,
          idleTimeoutMinutes: 30,
          hardTimeoutHours: 24,
          refreshGraceSeconds: 0,
        },
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    await new Promise((r) => setTimeout(r, 5));
    let caught: unknown;
    try {
      await handleSessionRefresh(
        {
          tenantId: f.tenantId,
          correlationId: 'c-r2',
          sessionId: boot.sessionId,
          presentedRefreshSecret: boot.refreshSecret,
          policy: {
            maxConcurrentSessions: 10,
            idleTimeoutMinutes: 30,
            hardTimeoutHours: 24,
            refreshGraceSeconds: 0,
          },
        },
        f.events,
        f.entities,
      );
    } catch (e) {
      caught = e;
    }
    expect((caught as IdentityError).code).toBe(identityErrorCodes.SESSION_REUSE_DETECTED);
    await dispatchAll(f);
    const stored = await getSessionEntity(f.entities, f.tenantId, boot.sessionId);
    expect(stored?.status).toBe('revoked');
    expect(stored?.endReason).toBe('reuse_detected');
  });
});

describe('session-management.feature: admin RevokeAllForUser', () => {
  it('every active session for the user flips to revoked', async () => {
    const f = fx();
    const boot = await bootstrapUserWithSession(f, 'alice@t1.com', 'correct-horse-Battery-staple');
    await handleSessionRevokeAllForUser(
      {
        tenantId: f.tenantId,
        correlationId: 'c-rev',
        principalId: 'admin',
        userId: boot.userId,
        reason: 'admin_revoke',
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    const stored = await getSessionEntity(f.entities, f.tenantId, boot.sessionId);
    expect(stored?.status).toBe('revoked');
  });
});

// =====================================================================
// api-key.feature
// =====================================================================

describe('api-key.feature: Create + bearer parses', () => {
  it('create returns plaintext bearer; parser round-trips', async () => {
    const f = fx();
    // Need a User so the ApiKey can attach.
    const boot = await bootstrapUserWithSession(f, 'op@t1.com', 'correct-horse-Battery-staple');
    const key = await handleApiKeyCreate(
      {
        tenantId: f.tenantId,
        correlationId: 'c-k',
        principalId: boot.userId,
        userId: boot.userId,
        name: 'CI deploy',
        scopes: ['ContentPages.Page.Create'],
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    expect(key.plaintextBearer.startsWith('atlas_')).toBe(true);
    const parsed = parseApiKeyBearer(key.plaintextBearer);
    expect(parsed?.keyId).toBe(key.document.keyId);
    expect(parsed?.secret.length).toBeGreaterThan(20);
    const stored = await getApiKeyEntity(f.entities, f.tenantId, key.document.keyId);
    expect(stored?.status).toBe('active');
    expect(stored?.scopes).toEqual(['ContentPages.Page.Create']);
  });
});

describe('api-key.feature: Rotate', () => {
  it('rotation mints successor with `rotatedFromKeyId`; predecessor flips to rotated', async () => {
    const f = fx();
    const boot = await bootstrapUserWithSession(f, 'op@t1.com', 'correct-horse-Battery-staple');
    const orig = await handleApiKeyCreate(
      {
        tenantId: f.tenantId,
        correlationId: 'c-k',
        principalId: boot.userId,
        userId: boot.userId,
        name: 'CI deploy',
        scopes: ['Catalog.Family.Get'],
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    const rotated = await handleApiKeyRotate(
      {
        tenantId: f.tenantId,
        correlationId: 'c-rot',
        principalId: boot.userId,
        keyId: orig.document.keyId,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    expect(rotated.successor.rotatedFromKeyId).toBe(orig.document.keyId);
    expect(rotated.predecessor.status).toBe('rotated');
    expect(rotated.predecessor.rotationOverlapUntil).toBeTruthy();
    // Same scopes carry over.
    expect(rotated.successor.scopes).toEqual(['Catalog.Family.Get']);
  });
});

describe('api-key.feature: Revoke', () => {
  it('revoke flips status; subsequent presentation rejected at OAuth issue', async () => {
    const f = fx();
    const boot = await bootstrapUserWithSession(f, 'op@t1.com', 'correct-horse-Battery-staple');
    const key = await handleApiKeyCreate(
      {
        tenantId: f.tenantId,
        correlationId: 'c-k',
        principalId: boot.userId,
        userId: boot.userId,
        name: 'CI deploy',
        scopes: ['Catalog.Family.Get'],
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    await handleApiKeyRevoke(
      {
        tenantId: f.tenantId,
        correlationId: 'c-rev',
        principalId: boot.userId,
        keyId: key.document.keyId,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    await expect(
      handleOAuthIssueToken(
        {
          tenantId: f.tenantId,
          correlationId: 'c-oauth',
          clientBearer: key.plaintextBearer,
        },
        f.events,
        f.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.OAUTH_INVALID_CLIENT });
  });
});

// =====================================================================
// service-principal-oauth.feature
// =====================================================================

describe('service-principal-oauth.feature: SP creation + scope ceiling', () => {
  it('ApiKey scopes cannot exceed SP scopes', async () => {
    const f = fx();
    const boot = await bootstrapUserWithSession(f, 'op@t1.com', 'correct-horse-Battery-staple');
    const sp = await handleServicePrincipalCreate(
      {
        tenantId: f.tenantId,
        correlationId: 'c-sp',
        principalId: boot.userId,
        ownerUserId: boot.userId,
        displayName: 'CI bot',
        scopes: ['Catalog.Family.Get'],
      },
      f.events,
    );
    await dispatchAll(f);
    // ApiKey within scope: ok.
    await expect(
      handleApiKeyCreate(
        {
          tenantId: f.tenantId,
          correlationId: 'c-k1',
          principalId: boot.userId,
          servicePrincipalId: sp.document.spId,
          name: 'within',
          scopes: ['Catalog.Family.Get'],
        },
        f.events,
        f.entities,
      ),
    ).resolves.toBeTruthy();
    // ApiKey beyond scope: refused.
    await expect(
      handleApiKeyCreate(
        {
          tenantId: f.tenantId,
          correlationId: 'c-k2',
          principalId: boot.userId,
          servicePrincipalId: sp.document.spId,
          name: 'beyond',
          scopes: ['ContentPages.Page.Delete'],
        },
        f.events,
        f.entities,
      ),
    ).rejects.toMatchObject({
      code: identityErrorCodes.SERVICE_PRINCIPAL_SCOPE_EXCEEDED,
    });
  });
});

describe('service-principal-oauth.feature: client_credentials → access token', () => {
  it('OAuth issue returns RFC 6749-shaped response; access token validates', async () => {
    const f = fx();
    const boot = await bootstrapUserWithSession(f, 'op@t1.com', 'correct-horse-Battery-staple');
    const sp = await handleServicePrincipalCreate(
      {
        tenantId: f.tenantId,
        correlationId: 'c-sp',
        principalId: boot.userId,
        ownerUserId: boot.userId,
        displayName: 'CI bot',
        scopes: ['Catalog.Family.Get'],
      },
      f.events,
    );
    await dispatchAll(f);
    const key = await handleApiKeyCreate(
      {
        tenantId: f.tenantId,
        correlationId: 'c-k',
        principalId: boot.userId,
        servicePrincipalId: sp.document.spId,
        name: 'CI bot key',
        scopes: ['Catalog.Family.Get'],
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    const issued = await handleOAuthIssueToken(
      {
        tenantId: f.tenantId,
        correlationId: 'c-oauth',
        clientBearer: key.plaintextBearer,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    expect(issued.response.token_type).toBe('Bearer');
    expect(issued.response.expires_in).toBe(3600);
    expect(issued.response.scope).toBe('Catalog.Family.Get');
    expect(issued.response.access_token.length).toBeGreaterThan(20);
    const stored = await getOAuthTokenEntity(f.entities, f.tenantId, issued.document.tokenId);
    expect(stored?.status).toBe('active');
  });
});

describe('service-principal-oauth.feature: revoke', () => {
  it('revoke flips token to revoked', async () => {
    const f = fx();
    const boot = await bootstrapUserWithSession(f, 'op@t1.com', 'correct-horse-Battery-staple');
    const sp = await handleServicePrincipalCreate(
      {
        tenantId: f.tenantId,
        correlationId: 'c-sp',
        principalId: boot.userId,
        ownerUserId: boot.userId,
        displayName: 'CI bot',
        scopes: ['Catalog.Family.Get'],
      },
      f.events,
    );
    await dispatchAll(f);
    const key = await handleApiKeyCreate(
      {
        tenantId: f.tenantId,
        correlationId: 'c-k',
        principalId: boot.userId,
        servicePrincipalId: sp.document.spId,
        name: 'k',
        scopes: ['Catalog.Family.Get'],
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    const issued = await handleOAuthIssueToken(
      {
        tenantId: f.tenantId,
        correlationId: 'c-oauth',
        clientBearer: key.plaintextBearer,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    const revoked = await handleOAuthRevokeToken(
      {
        tenantId: f.tenantId,
        correlationId: 'c-revoke',
        principalId: null,
        presentedToken: issued.response.access_token,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    expect(revoked.envelope?.eventType).toBe('Identity.OAuthTokenRevoked');
    // I10 — revoke event tags Tenant + the token entity.
    assertEventTags(revoked.envelope!, [
      `Tenant:${f.tenantId}`,
      `OAuthToken:${issued.document.tokenId}`,
    ]);
    const stored = await getOAuthTokenEntity(f.entities, f.tenantId, issued.document.tokenId);
    expect(stored?.status).toBe('revoked');
  });

  it('revoke with unknown token is a no-op (RFC 7009 §2.2)', async () => {
    const f = fx();
    const result = await handleOAuthRevokeToken(
      {
        tenantId: f.tenantId,
        correlationId: 'c-revoke',
        principalId: null,
        presentedToken: 'totally-not-a-real-token-aaaaaaaaaaaaaa',
      },
      f.events,
      f.entities,
    );
    expect(result.envelope).toBeNull();
  });
});

describe('service-principal-oauth.feature: disable SP cascades through key validation', () => {
  it('disabled SP refuses ApiKey creation', async () => {
    const f = fx();
    const boot = await bootstrapUserWithSession(f, 'op@t1.com', 'correct-horse-Battery-staple');
    const sp = await handleServicePrincipalCreate(
      {
        tenantId: f.tenantId,
        correlationId: 'c-sp',
        principalId: boot.userId,
        ownerUserId: boot.userId,
        displayName: 'CI bot',
        scopes: ['Catalog.Family.Get'],
      },
      f.events,
    );
    await dispatchAll(f);
    await handleServicePrincipalDisable(
      {
        tenantId: f.tenantId,
        correlationId: 'c-d',
        principalId: boot.userId,
        spId: sp.document.spId,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    const stored = await getServicePrincipalEntity(f.entities, f.tenantId, sp.document.spId);
    expect(stored?.status).toBe('disabled');
    await expect(
      handleApiKeyCreate(
        {
          tenantId: f.tenantId,
          correlationId: 'c-k',
          principalId: boot.userId,
          servicePrincipalId: sp.document.spId,
          name: 'after-disable',
          scopes: ['Catalog.Family.Get'],
        },
        f.events,
        f.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SERVICE_PRINCIPAL_DISABLED });
  });
});

// =====================================================================
// password.feature @phase-a2 promotions
// =====================================================================

describe('password.feature: Successful password login (now mints a session)', () => {
  it('success path includes sessionResult with cookie + access token', async () => {
    const f = fx();
    const boot = await bootstrapUserWithSession(f, 'alice@t1.com', 'correct-horse-Battery-staple');
    const result = await handlePasswordLogin(
      {
        tenantId: f.tenantId,
        correlationId: 'c-l',
        email: 'alice@t1.com',
        password: 'correct-horse-Battery-staple',
      },
      f.events,
      f.entities,
    );
    expect(result.envelope.eventType).toBe('Identity.LoginSucceeded');
    expect(result.sessionResult).toBeTruthy();
    expect(result.sessionResult?.cookiePayload).toContain('.');
    expect(result.sessionResult?.plaintextAccessToken.length).toBeGreaterThan(20);
    // I10 — login-success carries the tenant tag at minimum.
    assertEventTags(result.envelope, [`Tenant:${f.tenantId}`]);
    // sanity: the sessionId from the new login is different from the
    // one minted during bootstrap.
    expect(result.sessionResult?.document.sessionId).not.toBe(boot.sessionId);
  });
});
