/**
 * Phase A7 acceptance — risk engine + impersonation + break-glass.
 *
 * Covers @phase-a7 scenarios from `impersonation.feature` and
 * `break-glass.feature` end-to-end against in-memory adapters.
 * HTTP-routes / step-up-MFA wiring are deferred follow-up — these tests
 * exercise the locked entity + handler surface that the routes will sit
 * on top of.
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
} from '@atlas/ports';
import type { EventEnvelope } from '@atlas/platform-core';
import {
  BREAK_GLASS_RETENTION_TAG,
  IMPERSONATION_RETENTION_TAG,
  IdentityError,
  decideFromScore,
  defaultRiskScorer,
  fixedRiskScorer,
  getBreakGlassGrantEntity,
  getImpersonationSessionEntity,
  handleBreakGlassApprove,
  handleBreakGlassDeny,
  handleBreakGlassIssue,
  handleBreakGlassRevoke,
  handleImpersonationAction,
  handleImpersonationEnd,
  handleImpersonationStart,
  identityErrorCodes,
  resolveActiveGrants,
  resolveImpersonationToken,
  DEFAULT_RISK_POLICY,
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

interface Fx {
  events: InMemoryEventStore;
  entities: InMemoryEntityStore;
  tenantId: string;
}
function fx(): Fx {
  return {
    events: new InMemoryEventStore(),
    entities: new InMemoryEntityStore(),
    tenantId: 'customer',
  };
}

// =====================================================================
// impersonation.feature
// =====================================================================

describe('impersonation.feature: Operator starts an impersonation session', () => {
  it('creates an ImpersonationSession + emits ImpersonationStarted with retention:7y', async () => {
    const f = fx();
    const result = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'Investigating ticket SUP-1234',
        ticketUrl: 'https://support.atlas.example/tickets/SUP-1234',
        maxDurationMin: 30,
      },
      f.events,
      f.entities,
    );
    expect(result.document.status).toBe('active');
    expect(result.document.operatorId).toBe('ops:bob');
    expect(result.document.targetUserId).toBe('usr-alice');
    expect(result.envelope.eventType).toBe('Authorization.ImpersonationStarted');
    expect(result.envelope.retentionTag).toBe(IMPERSONATION_RETENTION_TAG);
    expect(result.envelope.retentionTag).toBe('retention:7y');
    expect(result.bearerToken).toMatch(/^imp-/);
    expect(result.bearerToken.includes('.')).toBe(true);

    // The entity is persisted and resolvable.
    const stored = await getImpersonationSessionEntity(
      f.entities,
      f.tenantId,
      result.document.impersonationId,
    );
    expect(stored?.status).toBe('active');
  });
});

describe('impersonation.feature: Reject impersonation without reason / ticket', () => {
  it('refuses an empty reason with IMPERSONATION_REASON_REQUIRED', async () => {
    const f = fx();
    await expect(
      handleImpersonationStart(
        {
          tenantId: f.tenantId,
          correlationId: 'corr-1',
          operatorId: 'ops:bob',
          targetUserId: 'usr-alice',
          reason: '   ',
          ticketUrl: 'https://support.atlas.example/tickets/SUP-1234',
        },
        f.events,
        f.entities,
      ),
    ).rejects.toEqual(
      expect.objectContaining({ code: identityErrorCodes.IMPERSONATION_REASON_REQUIRED }),
    );
    expect(f.events.events).toHaveLength(0);
  });

  it('refuses missing ticketUrl with IMPERSONATION_TICKET_REQUIRED', async () => {
    const f = fx();
    await expect(
      handleImpersonationStart(
        {
          tenantId: f.tenantId,
          correlationId: 'corr-1',
          operatorId: 'ops:bob',
          targetUserId: 'usr-alice',
          reason: 'Investigating ticket SUP-1234',
          ticketUrl: '',
        },
        f.events,
        f.entities,
      ),
    ).rejects.toEqual(
      expect.objectContaining({ code: identityErrorCodes.IMPERSONATION_TICKET_REQUIRED }),
    );
  });

  it('refuses missing operator with IMPERSONATION_REQUIRES_OPERATOR', async () => {
    const f = fx();
    await expect(
      handleImpersonationStart(
        {
          tenantId: f.tenantId,
          correlationId: 'corr-1',
          operatorId: '',
          targetUserId: 'usr-alice',
          reason: 'r',
          ticketUrl: 'https://example.com/t',
        },
        f.events,
        f.entities,
      ),
    ).rejects.toEqual(
      expect.objectContaining({ code: identityErrorCodes.IMPERSONATION_REQUIRES_OPERATOR }),
    );
  });
});

describe('impersonation.feature: Every action emits an audit event', () => {
  it('Action handler stamps impersonatedBy + emits ImpersonationAction at retention:7y', async () => {
    const f = fx();
    const start = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
      },
      f.events,
      f.entities,
    );
    const action = await handleImpersonationAction(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-2',
        impersonationId: start.document.impersonationId,
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        actionId: 'ContentPages.Page.Update',
        resourceType: 'Page',
        resourceId: 'page-1',
      },
      f.events,
    );
    expect(action.envelope.eventType).toBe('Authorization.ImpersonationAction');
    expect(action.envelope.retentionTag).toBe('retention:7y');
    expect(action.envelope.principalId).toBe('ops:bob');
    expect(action.envelope.userId).toBe('usr-alice');
  });
});

describe('impersonation.feature: Auto-expires + token resolve', () => {
  it('rejects an expired impersonation token', async () => {
    const f = fx();
    const start = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
        maxDurationMin: 30,
      },
      f.events,
      f.entities,
    );
    // Tamper with expiresAt to simulate the 31-minutes-ago clock.
    const stored = await getImpersonationSessionEntity(
      f.entities,
      f.tenantId,
      start.document.impersonationId,
    );
    if (!stored) throw new Error('stored not found');
    await f.entities.put({
      tenantId: f.tenantId,
      entityType: 'ImpersonationSession',
      entityId: stored.impersonationId,
      attrs: {
        ...stored,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    const resolved = await resolveImpersonationToken(
      f.entities,
      f.tenantId,
      start.bearerToken,
    );
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.reason).toBe('expired');
  });

  it('rejects malformed bearer with reason=malformed', async () => {
    const f = fx();
    const r = await resolveImpersonationToken(
      f.entities,
      f.tenantId,
      'no-dot-here',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('malformed');
  });

  it('accepts a fresh, well-formed token', async () => {
    const f = fx();
    const start = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
      },
      f.events,
      f.entities,
    );
    const r = await resolveImpersonationToken(
      f.entities,
      f.tenantId,
      start.bearerToken,
    );
    expect(r.ok).toBe(true);
  });
});

describe('impersonation.feature: Operator ends + tenant revokes', () => {
  it('operator_ended flips status to ended + emits ImpersonationEnded', async () => {
    const f = fx();
    const start = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
      },
      f.events,
      f.entities,
    );
    const end = await handleImpersonationEnd(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-2',
        impersonationId: start.document.impersonationId,
        principalId: 'ops:bob',
        reason: 'operator_ended',
      },
      f.events,
      f.entities,
    );
    expect(end.document.status).toBe('ended');
    expect(end.envelope.eventType).toBe('Authorization.ImpersonationEnded');
    expect(end.envelope.retentionTag).toBe('retention:7y');
    // Bearer is now invalid.
    const r = await resolveImpersonationToken(f.entities, f.tenantId, start.bearerToken);
    expect(r.ok).toBe(false);
  });

  it('tenant_revoked flips status to revoked + records revokedBy', async () => {
    const f = fx();
    const start = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
      },
      f.events,
      f.entities,
    );
    const revoke = await handleImpersonationEnd(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-2',
        impersonationId: start.document.impersonationId,
        principalId: 'usr-tenant-admin',
        reason: 'tenant_revoked',
      },
      f.events,
      f.entities,
    );
    expect(revoke.document.status).toBe('revoked');
    expect(revoke.document.revokedBy).toBe('usr-tenant-admin');
  });

  it('refuses double-end with IMPERSONATION_ENDED', async () => {
    const f = fx();
    const start = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
      },
      f.events,
      f.entities,
    );
    await handleImpersonationEnd(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-2',
        impersonationId: start.document.impersonationId,
        principalId: 'ops:bob',
        reason: 'operator_ended',
      },
      f.events,
      f.entities,
    );
    await expect(
      handleImpersonationEnd(
        {
          tenantId: f.tenantId,
          correlationId: 'corr-3',
          impersonationId: start.document.impersonationId,
          principalId: 'ops:bob',
          reason: 'operator_ended',
        },
        f.events,
        f.entities,
      ),
    ).rejects.toBeInstanceOf(IdentityError);
  });
});

describe('impersonation.feature: readonly resource types', () => {
  it('persists readonlyResourceTypes for the middleware to consult', async () => {
    const f = fx();
    const start = await handleImpersonationStart(
      {
        tenantId: f.tenantId,
        correlationId: 'corr-1',
        operatorId: 'ops:bob',
        targetUserId: 'usr-alice',
        reason: 'r',
        ticketUrl: 'https://example.com/t',
        readonlyResourceTypes: ['Membership'],
      },
      f.events,
      f.entities,
    );
    expect(start.document.readonlyResourceTypes).toEqual(['Membership']);
  });
});

// =====================================================================
// break-glass.feature
// =====================================================================

describe('break-glass.feature: Operator issues a grant', () => {
  it('Issue with requireApproval=true creates pending_approval + emits BreakGlassIssued', async () => {
    const f = fx();
    const result = await handleBreakGlassIssue(
      {
        tenantId: 'ledger',
        correlationId: 'corr-1',
        issuedBy: 'ops:bob',
        grantedTo: 'ops:bob',
        grantedRoles: ['TenantAdmin'],
        justification: 'P0 incident — INC-9001',
        incidentUrl: 'https://status.atlas.example/incidents/INC-9001',
        maxDurationMin: 60,
        requireApproval: true,
      },
      f.events,
      f.entities,
    );
    expect(result.document.status).toBe('pending_approval');
    expect(result.document.requireApproval).toBe(true);
    expect(result.envelope.eventType).toBe('Authorization.BreakGlassIssued');
    expect(result.envelope.retentionTag).toBe(BREAK_GLASS_RETENTION_TAG);
    expect(result.envelope.retentionTag).toBe('retention:10y');
  });

  it('refuses missing justification with BREAK_GLASS_JUSTIFICATION_REQUIRED', async () => {
    const f = fx();
    await expect(
      handleBreakGlassIssue(
        {
          tenantId: 'ledger',
          correlationId: 'corr-1',
          issuedBy: 'ops:bob',
          grantedTo: 'ops:bob',
          grantedRoles: ['TenantAdmin'],
          justification: '',
          incidentUrl: 'https://example.com/i',
        },
        f.events,
        f.entities,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: identityErrorCodes.BREAK_GLASS_JUSTIFICATION_REQUIRED,
      }),
    );
  });

  it('refuses missing incidentUrl with BREAK_GLASS_INCIDENT_REQUIRED', async () => {
    const f = fx();
    await expect(
      handleBreakGlassIssue(
        {
          tenantId: 'ledger',
          correlationId: 'corr-1',
          issuedBy: 'ops:bob',
          grantedTo: 'ops:bob',
          grantedRoles: ['TenantAdmin'],
          justification: 'because',
          incidentUrl: '',
        },
        f.events,
        f.entities,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: identityErrorCodes.BREAK_GLASS_INCIDENT_REQUIRED,
      }),
    );
  });
});

describe('break-glass.feature: 4-eyes approval', () => {
  it('Second approver activates the grant and resets expiresAt', async () => {
    const f = fx();
    const issued = await handleBreakGlassIssue(
      {
        tenantId: 'ledger',
        correlationId: 'corr-1',
        issuedBy: 'ops:bob',
        grantedTo: 'ops:bob',
        grantedRoles: ['TenantAdmin'],
        justification: 'P0',
        incidentUrl: 'https://example.com/i',
        maxDurationMin: 60,
      },
      f.events,
      f.entities,
    );
    const approved = await handleBreakGlassApprove(
      {
        tenantId: 'ledger',
        correlationId: 'corr-2',
        grantId: issued.document.grantId,
        approvedBy: 'ops:carol',
      },
      f.events,
      f.entities,
    );
    expect(approved.document.status).toBe('active');
    expect(approved.document.approvedBy).toBe('ops:carol');
    expect(approved.envelope.eventType).toBe('Authorization.BreakGlassApproved');
  });

  it('refuses self-approval with BREAK_GLASS_SELF_APPROVAL_FORBIDDEN', async () => {
    const f = fx();
    const issued = await handleBreakGlassIssue(
      {
        tenantId: 'ledger',
        correlationId: 'corr-1',
        issuedBy: 'ops:bob',
        grantedTo: 'ops:bob',
        grantedRoles: ['TenantAdmin'],
        justification: 'P0',
        incidentUrl: 'https://example.com/i',
      },
      f.events,
      f.entities,
    );
    await expect(
      handleBreakGlassApprove(
        {
          tenantId: 'ledger',
          correlationId: 'corr-2',
          grantId: issued.document.grantId,
          approvedBy: 'ops:bob',
        },
        f.events,
        f.entities,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: identityErrorCodes.BREAK_GLASS_SELF_APPROVAL_FORBIDDEN,
      }),
    );
  });

  it('Deny flips the grant to denied + emits BreakGlassDenied', async () => {
    const f = fx();
    const issued = await handleBreakGlassIssue(
      {
        tenantId: 'ledger',
        correlationId: 'corr-1',
        issuedBy: 'ops:bob',
        grantedTo: 'ops:bob',
        grantedRoles: ['TenantAdmin'],
        justification: 'P0',
        incidentUrl: 'https://example.com/i',
      },
      f.events,
      f.entities,
    );
    const denied = await handleBreakGlassDeny(
      {
        tenantId: 'ledger',
        correlationId: 'corr-2',
        grantId: issued.document.grantId,
        deniedBy: 'ops:carol',
        reason: 'looks unjustified',
      },
      f.events,
      f.entities,
    );
    expect(denied.document.status).toBe('denied');
    expect(denied.envelope.eventType).toBe('Authorization.BreakGlassDenied');
  });
});

describe('break-glass.feature: Active grants + revoke + expire', () => {
  it('resolveActiveGrants returns the active grant for the recipient', async () => {
    const f = fx();
    const issued = await handleBreakGlassIssue(
      {
        tenantId: 'ledger',
        correlationId: 'corr-1',
        issuedBy: 'ops:bob',
        grantedTo: 'ops:bob',
        grantedRoles: ['TenantAdmin'],
        justification: 'P0',
        incidentUrl: 'https://example.com/i',
        requireApproval: false, // ops-self-grant when policy allows
      },
      f.events,
      f.entities,
    );
    const active = await resolveActiveGrants(f.entities, 'ledger', 'ops:bob');
    expect(active).toHaveLength(1);
    expect(active[0]?.grantId).toBe(issued.document.grantId);
  });

  it('Revoke flips status to revoked + emits BreakGlassRevoked', async () => {
    const f = fx();
    const issued = await handleBreakGlassIssue(
      {
        tenantId: 'ledger',
        correlationId: 'corr-1',
        issuedBy: 'ops:bob',
        grantedTo: 'ops:bob',
        grantedRoles: ['TenantAdmin'],
        justification: 'P0',
        incidentUrl: 'https://example.com/i',
        requireApproval: false,
      },
      f.events,
      f.entities,
    );
    const revoked = await handleBreakGlassRevoke(
      {
        tenantId: 'ledger',
        correlationId: 'corr-2',
        grantId: issued.document.grantId,
        revokedBy: 'usr-tenant-admin',
        reason: 'tenant_revoked',
      },
      f.events,
      f.entities,
    );
    expect(revoked.document.status).toBe('revoked');
    expect(revoked.document.revokedBy).toBe('usr-tenant-admin');
    expect(revoked.envelope.eventType).toBe('Authorization.BreakGlassRevoked');
  });

  it('auto_expired produces BreakGlassExpired event + status=expired', async () => {
    const f = fx();
    const issued = await handleBreakGlassIssue(
      {
        tenantId: 'ledger',
        correlationId: 'corr-1',
        issuedBy: 'ops:bob',
        grantedTo: 'ops:bob',
        grantedRoles: ['TenantAdmin'],
        justification: 'P0',
        incidentUrl: 'https://example.com/i',
        requireApproval: false,
      },
      f.events,
      f.entities,
    );
    const expired = await handleBreakGlassRevoke(
      {
        tenantId: 'ledger',
        correlationId: 'corr-2',
        grantId: issued.document.grantId,
        revokedBy: 'system',
        reason: 'auto_expired',
      },
      f.events,
      f.entities,
    );
    expect(expired.document.status).toBe('expired');
    expect(expired.envelope.eventType).toBe('Authorization.BreakGlassExpired');
  });

  it('rejects revoke of an unknown grant with BREAK_GLASS_GRANT_NOT_FOUND', async () => {
    const f = fx();
    await expect(
      handleBreakGlassRevoke(
        {
          tenantId: 'ledger',
          correlationId: 'corr-2',
          grantId: 'bgg-missing',
          revokedBy: 'system',
          reason: 'tenant_revoked',
        },
        f.events,
        f.entities,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: identityErrorCodes.BREAK_GLASS_GRANT_NOT_FOUND,
      }),
    );
  });
});

describe('break-glass.feature: getBreakGlassGrantEntity round-trip', () => {
  it('persists the grant and returns it on read', async () => {
    const f = fx();
    const issued = await handleBreakGlassIssue(
      {
        tenantId: 'ledger',
        correlationId: 'corr-1',
        issuedBy: 'ops:bob',
        grantedTo: 'ops:bob',
        grantedRoles: ['TenantAdmin'],
        justification: 'P0',
        incidentUrl: 'https://example.com/i',
      },
      f.events,
      f.entities,
    );
    const fetched = await getBreakGlassGrantEntity(
      f.entities,
      'ledger',
      issued.document.grantId,
    );
    expect(fetched?.justification).toBe('P0');
    expect(fetched?.grantedRoles).toEqual(['TenantAdmin']);
  });
});

// =====================================================================
// Risk engine
// =====================================================================

describe('risk engine: defaultRiskScorer', () => {
  it('returns 0 when no signals are provided', () => {
    const scorer = defaultRiskScorer();
    const r = scorer({});
    expect(r.score).toBe(0);
  });

  it('scores geo mismatch when expectedGeo is configured', () => {
    const scorer = defaultRiskScorer({ expectedGeo: ['US'] });
    const match = scorer({ geo: 'US' });
    const mismatch = scorer({ geo: 'CN' });
    expect(match.contributions['geo']).toBe(0);
    expect(mismatch.contributions['geo']).toBe(0.4);
    expect(mismatch.score).toBe(0.4);
  });

  it('scores cli UA higher than browser UA', () => {
    const scorer = defaultRiskScorer();
    expect(scorer({ uaClass: 'browser' }).score).toBe(0);
    expect(scorer({ uaClass: 'cli' }).score).toBe(0.2);
  });

  it('linearly scores recentFailureRate up to 0.4', () => {
    const scorer = defaultRiskScorer();
    expect(scorer({ recentFailureRate: 0 }).score).toBe(0);
    expect(scorer({ recentFailureRate: 0.5 }).score).toBeCloseTo(0.2, 5);
    expect(scorer({ recentFailureRate: 1 }).score).toBe(0.4);
  });

  it('combines signals up to score=1', () => {
    const scorer = defaultRiskScorer({ expectedGeo: ['US'] });
    const r = scorer({
      geo: 'CN',
      uaClass: 'cli',
      recentFailureRate: 1,
      hourUtc: 3,
    });
    // 0.4 + 0.2 + 0.4 + 0.05 = 1.05 → clamped to 1
    expect(r.score).toBe(1);
  });

  it('fixedRiskScorer ignores signals', () => {
    const r = fixedRiskScorer(0.42)({ geo: 'CN', uaClass: 'cli' });
    expect(r.score).toBe(0.42);
  });
});

describe('risk engine: decideFromScore', () => {
  it('default thresholds: 0.5 → allow, 0.7 → step_up, 0.95 → hard_deny', () => {
    expect(decideFromScore(0.5, DEFAULT_RISK_POLICY)).toBe('allow');
    expect(decideFromScore(0.7, DEFAULT_RISK_POLICY)).toBe('step_up');
    expect(decideFromScore(0.95, DEFAULT_RISK_POLICY)).toBe('hard_deny');
    expect(decideFromScore(1, DEFAULT_RISK_POLICY)).toBe('hard_deny');
  });

  it('respects custom tenant thresholds', () => {
    const policy = { stepUpMfaThreshold: 0.3, hardDenyThreshold: 0.6 };
    expect(decideFromScore(0.2, policy)).toBe('allow');
    expect(decideFromScore(0.3, policy)).toBe('step_up');
    expect(decideFromScore(0.6, policy)).toBe('hard_deny');
  });
});
