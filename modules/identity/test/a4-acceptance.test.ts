/**
 * Phase A4 acceptance — SCIM 2.0 + audit export.
 *
 * Covers @phase-a4-tagged scenarios from `scim.feature` + audit
 * export. End-to-end against in-memory adapters; the SCIM HTTP
 * surface is not exercised here (route-layer is integration-tested
 * in Playwright when the harness lifts) — these tests cover the
 * underlying handlers + dispatcher chain.
 */

import { describe, it, expect } from 'vitest';
import type {
  EventStore,
  StoredEvent,
  Entity,
  EntityListOptions,
  EntityQueryOptions,
  EntityStore as PortEntityStore,
  EntityWriteInput,
  Relation,
  RelationStore,
  RelationWriteInput,
} from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import {
  handleAuditExportActivate,
  handleAuditExportConfigure,
  handleAuditExportDisable,
  handleScimTokenEnable,
  handleScimTokenRevoke,
  handleScimTokenRotate,
  handleUserCreate,
  dispatchIdentityEvent,
  exportTenantAudit,
  findScimTokensByLookup,
  getAuditExportConfig,
  getScimTokenEntity,
  hashSecret,
  identityErrorCodes,
  IdentityError,
  InMemoryUploader,
  lookupOf,
  verifyPassword,
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
  async findByIdempotencyKey(t: string, k: string): Promise<EventEnvelope | null> {
    return this.events.find((e) => e.tenantId === t && e.idempotencyKey === k) ?? null;
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
  async get<T = unknown>(t: string, ty: string, id: string): Promise<Entity<T> | null> {
    const r = this.rows.get(this.k(t, ty, id));
    if (!r || r.status === 'deleted') return null;
    return r as Entity<T>;
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
    const e = this.rows.get(key);
    if (e) this.rows.set(key, { ...e, status: 'deleted' });
  }
  async list<T = unknown>(t: string, ty: string, opts?: EntityListOptions): Promise<Entity<T>[]> {
    const desired = opts?.status === undefined ? 'active' : opts.status;
    return Array.from(this.rows.values())
      .filter((r) => r.tenantId === t && r.entityType === ty)
      .filter((r) => (desired === null ? true : r.status === desired)) as Entity<T>[];
  }
  async query<T = unknown>(t: string, ty: string, opts: EntityQueryOptions): Promise<Entity<T>[]> {
    const all = Array.from(this.rows.values()).filter(
      (r) => r.tenantId === t && r.entityType === ty,
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
    tenantId: 'enterprise',
  };
}
async function dispatchAll(f: Fx): Promise<void> {
  for (const e of f.events.events) {
    await dispatchIdentityEvent(e, { entities: f.entities, relations: f.relations });
  }
}

// =====================================================================
// SCIM tokens
// =====================================================================

describe('scim.feature: ScimToken Enable + lookup', () => {
  it('Enable mints a token; lookup resolves it; verify matches', async () => {
    const f = fx();
    const result = await handleScimTokenEnable(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        name: 'Okta production',
      },
      f.events,
    );
    await dispatchAll(f);
    expect(result.plaintextSecret.length).toBeGreaterThan(20);
    expect(result.document.status).toBe('active');
    expect(result.document.secretHash).toMatch(/^\$scrypt\$/);
    expect(result.document.secretLookup).toBe(lookupOf(result.plaintextSecret));
    // Bucket lookup + verify roundtrip.
    const candidates = await findScimTokensByLookup(
      f.entities,
      f.tenantId,
      lookupOf(result.plaintextSecret),
    );
    expect(candidates.length).toBe(1);
    const ok = await verifyPassword(result.plaintextSecret, candidates[0]!.secretHash);
    expect(ok).toBe(true);
    void hashSecret;
  });

  it('Rotate: predecessor flips to rotated with overlap; successor active', async () => {
    const f = fx();
    const orig = await handleScimTokenEnable(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        name: 'rotate-me',
      },
      f.events,
    );
    await dispatchAll(f);
    const rotated = await handleScimTokenRotate(
      {
        tenantId: f.tenantId,
        correlationId: 'c2',
        principalId: 'admin',
        tokenId: orig.document.tokenId,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    expect(rotated.predecessor.status).toBe('rotated');
    expect(rotated.predecessor.rotatedToTokenId).toBe(rotated.successor.tokenId);
    expect(rotated.successor.status).toBe('active');
    expect(rotated.successor.rotatedFromTokenId).toBe(orig.document.tokenId);
    expect(rotated.predecessor.rotationOverlapUntil).toBeTruthy();
  });

  it('Revoke flips to revoked; subsequent rotate refuses', async () => {
    const f = fx();
    const orig = await handleScimTokenEnable(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        name: 't',
      },
      f.events,
    );
    await dispatchAll(f);
    await handleScimTokenRevoke(
      {
        tenantId: f.tenantId,
        correlationId: 'c2',
        principalId: 'admin',
        tokenId: orig.document.tokenId,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    const stored = await getScimTokenEntity(f.entities, f.tenantId, orig.document.tokenId);
    expect(stored?.status).toBe('revoked');
    await expect(
      handleScimTokenRotate(
        {
          tenantId: f.tenantId,
          correlationId: 'c3',
          principalId: 'admin',
          tokenId: orig.document.tokenId,
        },
        f.events,
        f.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.SCIM_TOKEN_REVOKED });
  });
});

// =====================================================================
// Audit retention tagging
// =====================================================================

describe('audit-export.feature: retention tagging', () => {
  it('AuditExportConfigured carries retention:1y by default', async () => {
    const f = fx();
    const result = await handleAuditExportConfigure(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        destination: {
          kind: 's3',
          bucket: 'enterprise-audit',
          region: 'us-east-1',
          accessKeyId: 'AKIA',
          secretAccessKey: 'shh',
        },
        cadence: 'daily',
      },
      f.events,
      f.entities,
    );
    expect(result.envelope.retentionTag).toBe('retention:1y');
  });

  it('Configure rejects destinations missing bucket/region/auth', async () => {
    const f = fx();
    await expect(
      handleAuditExportConfigure(
        {
          tenantId: f.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          destination: {
            kind: 's3',
            bucket: '',
            region: 'us-east-1',
            accessKeyId: 'a',
            secretAccessKey: 'b',
          },
          cadence: 'daily',
        },
        f.events,
        f.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.AUDIT_EXPORT_DEST_INVALID });
    await expect(
      handleAuditExportConfigure(
        {
          tenantId: f.tenantId,
          correlationId: 'c',
          principalId: 'admin',
          destination: {
            kind: 's3',
            bucket: 'b',
            region: 'us',
          },
          cadence: 'daily',
        },
        f.events,
        f.entities,
      ),
    ).rejects.toMatchObject({ code: identityErrorCodes.AUDIT_EXPORT_DEST_INVALID });
  });
});

// =====================================================================
// Audit export pipeline
// =====================================================================

describe('audit-export.feature: end-to-end run', () => {
  it('drains events, pushes to mock S3, advances cursor', async () => {
    const f = fx();
    // Configure + activate.
    await handleAuditExportConfigure(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        destination: {
          kind: 's3',
          bucket: 'enterprise-audit',
          region: 'us-east-1',
          accessKeyId: 'AKIA',
          secretAccessKey: 'shh',
        },
        cadence: 'hourly',
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    const cfgId = `audex:${f.tenantId}`;
    await handleAuditExportActivate(
      {
        tenantId: f.tenantId,
        correlationId: 'c2',
        principalId: 'admin',
        configId: cfgId,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);

    // Generate some audit-eligible events.
    for (let i = 0; i < 3; i += 1) {
      await handleUserCreate(
        {
          tenantId: f.tenantId,
          correlationId: `c-u${i}`,
          principalId: 'admin',
          email: `u${i}@enterprise.example`,
        },
        f.events,
      );
    }
    await dispatchAll(f);

    const uploader = new InMemoryUploader();
    const run = await exportTenantAudit(
      f.tenantId,
      cfgId,
      uploader,
      f.events,
      f.entities,
    );
    expect(run.status).toBe('succeeded');
    expect(run.eventCount).toBeGreaterThan(0);
    expect(uploader.pushed.length).toBe(1);
    // JSON-Lines: one envelope per line, valid JSON each.
    const body = uploader.pushed[0]!.body.toString('utf8');
    const lines = body.trim().split('\n');
    expect(lines.length).toBe(run.eventCount);
    for (const l of lines) {
      const parsed = JSON.parse(l);
      expect(parsed.tenantId).toBe(f.tenantId);
    }

    // Subsequent run with no new events: empty success, cursor unchanged.
    const second = await exportTenantAudit(
      f.tenantId,
      cfgId,
      uploader,
      f.events,
      f.entities,
    );
    expect(second.eventCount).toBe(0);
    expect(uploader.pushed.length).toBe(1); // no new push
    expect(second.toCursor).toBe(run.toCursor);
  });

  it('refuses when config is in `disabled` status', async () => {
    const f = fx();
    await handleAuditExportConfigure(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        destination: {
          kind: 's3',
          bucket: 'b',
          region: 'r',
          accessKeyId: 'a',
          secretAccessKey: 's',
        },
        cadence: 'daily',
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    const cfgId = `audex:${f.tenantId}`;
    await handleAuditExportDisable(
      {
        tenantId: f.tenantId,
        correlationId: 'c2',
        principalId: 'admin',
        configId: cfgId,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    const cfg = await getAuditExportConfig(f.entities, f.tenantId, cfgId);
    expect(cfg?.status).toBe('disabled');
    await expect(
      exportTenantAudit(
        f.tenantId,
        cfgId,
        new InMemoryUploader(),
        f.events,
        f.entities,
      ),
    ).rejects.toThrow(/must be active/);
  });

  it('records failure when uploader throws; cursor does NOT advance', async () => {
    const f = fx();
    await handleAuditExportConfigure(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        destination: {
          kind: 's3',
          bucket: 'b',
          region: 'r',
          accessKeyId: 'a',
          secretAccessKey: 's',
        },
        cadence: 'daily',
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    const cfgId = `audex:${f.tenantId}`;
    await handleAuditExportActivate(
      {
        tenantId: f.tenantId,
        correlationId: 'c2',
        principalId: 'admin',
        configId: cfgId,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    await handleUserCreate(
      {
        tenantId: f.tenantId,
        correlationId: 'c3',
        principalId: 'admin',
        email: 'u@enterprise.example',
      },
      f.events,
    );
    await dispatchAll(f);
    const failingUploader = {
      async upload(): Promise<{ bytes: number }> {
        throw new Error('S3 unreachable');
      },
    };
    const run = await exportTenantAudit(
      f.tenantId,
      cfgId,
      failingUploader,
      f.events,
      f.entities,
    );
    expect(run.status).toBe('failed');
    expect(run.failureReason).toContain('S3 unreachable');
    const cfg = await getAuditExportConfig(f.entities, f.tenantId, cfgId);
    expect(cfg?.cursor).toBeUndefined();
    expect(cfg?.lastFailureReason).toContain('S3 unreachable');
  });

  it('retentionFilter narrows export to specific tiers', async () => {
    const f = fx();
    await handleAuditExportConfigure(
      {
        tenantId: f.tenantId,
        correlationId: 'c',
        principalId: 'admin',
        destination: {
          kind: 's3',
          bucket: 'b',
          region: 'r',
          accessKeyId: 'a',
          secretAccessKey: 's',
        },
        cadence: 'daily',
        retentionFilter: ['retention:7y', 'retention:10y'],
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    const cfgId = `audex:${f.tenantId}`;
    await handleAuditExportActivate(
      {
        tenantId: f.tenantId,
        correlationId: 'c2',
        principalId: 'admin',
        configId: cfgId,
      },
      f.events,
      f.entities,
    );
    await dispatchAll(f);
    // UserCreated emits with retentionTag=undefined which the export
    // pipeline reads as `retention:1y`; with the filter set to 7y/10y
    // these events should NOT be exported.
    await handleUserCreate(
      {
        tenantId: f.tenantId,
        correlationId: 'c3',
        principalId: 'admin',
        email: 'noisy@enterprise.example',
      },
      f.events,
    );
    await dispatchAll(f);
    const uploader = new InMemoryUploader();
    const run = await exportTenantAudit(
      f.tenantId,
      cfgId,
      uploader,
      f.events,
      f.entities,
    );
    expect(run.status).toBe('succeeded');
    expect(run.eventCount).toBe(0);
    expect(uploader.pushed.length).toBe(0);
  });
});

// =====================================================================
// Smoke: invalid IdentityError surfaces (not real test, just guard)
// =====================================================================

describe('error envelope smoke', () => {
  it('IdentityError carries SCIM_INVALID_TOKEN/SCIM_RESOURCE_NOT_FOUND code surface', () => {
    const err = new IdentityError(
      identityErrorCodes.SCIM_INVALID_TOKEN,
      'bad token',
      401,
    );
    expect(err.code).toBe('SCIM_INVALID_TOKEN');
    expect(err.status).toBe(401);
  });
});
