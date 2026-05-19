/**
 * Phase A7 — Break-glass handlers.
 *
 *   Authorization.BreakGlass.Issue    — operator opens a pending grant.
 *   Authorization.BreakGlass.Approve  — second operator activates (4-eyes).
 *   Authorization.BreakGlass.Deny     — second operator refuses.
 *   Authorization.BreakGlass.Action   — emitted alongside any action a
 *     running grant authorizes (mandatory audit pair).
 *   Authorization.BreakGlass.Revoke   — tenant admin / platform ends
 *     active grant in flight.
 *   Authorization.BreakGlass.Expire   — bookkeeping when an active grant
 *     ages past `expiresAt`.
 *
 * Audit retention: every emitted event carries `retention:10y` (strictest
 * tier — non-shortenable).
 *
 * The handlers verify state transitions but DO NOT enforce role-based
 * authorization on the principals (operator authority gate, scope-vs-issuer
 * check, etc.). Those run in the route layer where the calling principal
 * is known. Handlers stay pure.
 */
import type { EventEnvelope } from '@atlas/platform-core';
import type { EntityStore, EventStore } from '@atlas/ports';
import { IdentityError, codes } from '../errors.ts';
import type { BreakGlassEndReason, BreakGlassGrantDocument, } from '../types.ts';
import { newBreakGlassGrantId, newEventId } from '../ids.ts';
import { getBreakGlassGrantEntity, putBreakGlassGrantEntity, } from '../entities/break-glass-grant.ts';
/** Platform-side retention tier — strictest, non-shortenable. */
export const BREAK_GLASS_RETENTION_TAG = 'retention:10y';
const MAX_DURATION_HARD_CAP_MIN = 12 * 60; // 12 hours
const DEFAULT_DURATION_MIN = 60;
// =====================================================================
// Issue
// =====================================================================
export interface BreakGlassIssueCommand {
    tenantId: string;
    correlationId: string;
    /** Operator issuing the grant. Required. */
    issuedBy: string;
    /** Principal id receiving the grant. Often the issuer themselves. */
    grantedTo: string;
    grantedRoles: ReadonlyArray<string>;
    resourceTypeAllowList?: ReadonlyArray<string>;
    justification: string;
    incidentUrl: string;
    maxDurationMin?: number;
    /**
     * Whether 4-eyes approval is required. Caller computes this from
     * tenant policy (production tenants typically true). Default `true`
     * — handler defaults safe-side.
     */
    requireApproval?: boolean;
}
export interface BreakGlassIssueResult {
    envelope: EventEnvelope;
    document: BreakGlassGrantDocument;
}
export async function handleBreakGlassIssue(cmd: BreakGlassIssueCommand, eventStore: EventStore, entities: EntityStore): Promise<BreakGlassIssueResult> {
    if (!cmd.issuedBy) {
        throw new IdentityError(codes.BREAK_GLASS_REQUIRES_OPERATOR, 'BreakGlass.Issue requires an issuedBy principal', 403);
    }
    if (!cmd.justification || cmd.justification.trim().length === 0) {
        throw new IdentityError(codes.BREAK_GLASS_JUSTIFICATION_REQUIRED, 'BreakGlass.Issue requires a non-empty justification', 400);
    }
    if (!cmd.incidentUrl || cmd.incidentUrl.trim().length === 0) {
        throw new IdentityError(codes.BREAK_GLASS_INCIDENT_REQUIRED, 'BreakGlass.Issue requires an incidentUrl', 400);
    }
    const duration = cmd.maxDurationMin ?? DEFAULT_DURATION_MIN;
    if (duration <= 0 || duration > MAX_DURATION_HARD_CAP_MIN) {
        throw new IdentityError(codes.BREAK_GLASS_DURATION_INVALID, `maxDurationMin must be 1..${MAX_DURATION_HARD_CAP_MIN}`, 400);
    }
    if (cmd.grantedRoles.length === 0) {
        throw new IdentityError(codes.IDENTITY_INVALID, 'grantedRoles must be non-empty', 400);
    }
    const requireApproval = cmd.requireApproval ?? true;
    const occurredAt = new Date().toISOString();
    const grantId = newBreakGlassGrantId();
    // expiresAt for a pending grant is "would-be expiry assuming
    // immediate approval." It updates on Approve.
    const expiresAt = new Date(Date.now() + duration * 60 * 1000).toISOString();
    const document: BreakGlassGrantDocument = {
        grantId,
        tenantId: cmd.tenantId,
        issuedBy: cmd.issuedBy,
        grantedTo: cmd.grantedTo,
        grantedRoles: cmd.grantedRoles,
        ...(cmd.resourceTypeAllowList !== undefined
            ? { resourceTypeAllowList: cmd.resourceTypeAllowList }
            : {}),
        justification: cmd.justification,
        incidentUrl: cmd.incidentUrl,
        maxDurationMin: duration,
        requireApproval,
        // No-approval-required path: the grant is active immediately.
        status: requireApproval ? 'pending_approval' : 'active',
        issuedAt: occurredAt,
        expiresAt,
        ...(requireApproval
            ? {}
            : { approvedAt: occurredAt, approvedBy: cmd.issuedBy }),
    };
    await putBreakGlassGrantEntity(entities, document);
    const envelope: EventEnvelope = {
        eventId: newEventId(),
        eventType: 'Authorization.BreakGlassIssued',
        schemaId: 'domain.authorization.break_glass_issued.v1',
        schemaVersion: 1,
        occurredAt,
        tenantId: cmd.tenantId,
        correlationId: cmd.correlationId,
        idempotencyKey: `authz.break_glass.issue.${grantId}`,
        causationId: null,
        principalId: cmd.issuedBy,
        userId: null,
        cacheInvalidationTags: [
            `Tenant:${cmd.tenantId}`,
            `Principal:${cmd.grantedTo}`,
            `BreakGlassGrant:${grantId}`,
        ],
        retentionTag: BREAK_GLASS_RETENTION_TAG,
        payload: {
            grantId,
            issuedBy: cmd.issuedBy,
            grantedTo: cmd.grantedTo,
            grantedRoles: [...cmd.grantedRoles],
            justification: cmd.justification,
            incidentUrl: cmd.incidentUrl,
            maxDurationMin: duration,
            requireApproval,
            status: document.status,
        },
    };
    const stored = await eventStore.append(envelope);
    envelope.eventId = stored.eventId;
    envelope.seq = stored.seq;
    return { envelope, document };
}
// =====================================================================
// Approve
// =====================================================================
export interface BreakGlassApproveCommand {
    tenantId: string;
    correlationId: string;
    grantId: string;
    /** Approver's principal — must differ from issuer (4-eyes). */
    approvedBy: string;
}
export interface BreakGlassApproveResult {
    envelope: EventEnvelope;
    document: BreakGlassGrantDocument;
}
export async function handleBreakGlassApprove(cmd: BreakGlassApproveCommand, eventStore: EventStore, entities: EntityStore): Promise<BreakGlassApproveResult> {
    const existing = await getBreakGlassGrantEntity(entities, cmd.tenantId, cmd.grantId);
    if (!existing) {
        throw new IdentityError(codes.BREAK_GLASS_GRANT_NOT_FOUND, 'break-glass grant not found', 404);
    }
    if (existing.status !== 'pending_approval') {
        throw new IdentityError(codes.BREAK_GLASS_NOT_PENDING, `grant in status ${existing.status}`, 409);
    }
    if (existing.issuedBy === cmd.approvedBy) {
        throw new IdentityError(codes.BREAK_GLASS_SELF_APPROVAL_FORBIDDEN, 'issuer and approver must differ (4-eyes)', 403);
    }
    const occurredAt = new Date().toISOString();
    // Reset the expiry window from approval time. The pending window doesn't
    // count against the operator's grant duration.
    const expiresAt = new Date(Date.now() + existing.maxDurationMin * 60 * 1000).toISOString();
    const next: BreakGlassGrantDocument = {
        ...existing,
        status: 'active',
        approvedAt: occurredAt,
        approvedBy: cmd.approvedBy,
        expiresAt,
    };
    await putBreakGlassGrantEntity(entities, next);
    const envelope: EventEnvelope = {
        eventId: newEventId(),
        eventType: 'Authorization.BreakGlassApproved',
        schemaId: 'domain.authorization.break_glass_approved.v1',
        schemaVersion: 1,
        occurredAt,
        tenantId: cmd.tenantId,
        correlationId: cmd.correlationId,
        idempotencyKey: `authz.break_glass.approve.${cmd.grantId}`,
        causationId: null,
        principalId: cmd.approvedBy,
        userId: null,
        cacheInvalidationTags: [
            `Tenant:${cmd.tenantId}`,
            `Principal:${existing.grantedTo}`,
            `BreakGlassGrant:${cmd.grantId}`,
        ],
        retentionTag: BREAK_GLASS_RETENTION_TAG,
        payload: {
            grantId: cmd.grantId,
            issuedBy: existing.issuedBy,
            grantedTo: existing.grantedTo,
            approvedBy: cmd.approvedBy,
            expiresAt,
        },
    };
    const stored = await eventStore.append(envelope);
    envelope.eventId = stored.eventId;
    envelope.seq = stored.seq;
    return { envelope, document: next };
}
// =====================================================================
// Deny — second-approver refuses.
// =====================================================================
export interface BreakGlassDenyCommand {
    tenantId: string;
    correlationId: string;
    grantId: string;
    deniedBy: string;
    reason?: string;
}
export interface BreakGlassDenyResult {
    envelope: EventEnvelope;
    document: BreakGlassGrantDocument;
}
export async function handleBreakGlassDeny(cmd: BreakGlassDenyCommand, eventStore: EventStore, entities: EntityStore): Promise<BreakGlassDenyResult> {
    const existing = await getBreakGlassGrantEntity(entities, cmd.tenantId, cmd.grantId);
    if (!existing) {
        throw new IdentityError(codes.BREAK_GLASS_GRANT_NOT_FOUND, 'break-glass grant not found', 404);
    }
    if (existing.status !== 'pending_approval') {
        throw new IdentityError(codes.BREAK_GLASS_NOT_PENDING, `grant in status ${existing.status}`, 409);
    }
    if (existing.issuedBy === cmd.deniedBy) {
        throw new IdentityError(codes.BREAK_GLASS_SELF_APPROVAL_FORBIDDEN, 'issuer and approver must differ (4-eyes)', 403);
    }
    const occurredAt = new Date().toISOString();
    const next: BreakGlassGrantDocument = {
        ...existing,
        status: 'denied',
        endedAt: occurredAt,
        endReason: 'denied_by_approver',
    };
    await putBreakGlassGrantEntity(entities, next);
    const envelope: EventEnvelope = {
        eventId: newEventId(),
        eventType: 'Authorization.BreakGlassDenied',
        schemaId: 'domain.authorization.break_glass_denied.v1',
        schemaVersion: 1,
        occurredAt,
        tenantId: cmd.tenantId,
        correlationId: cmd.correlationId,
        idempotencyKey: `authz.break_glass.deny.${cmd.grantId}`,
        causationId: null,
        principalId: cmd.deniedBy,
        userId: null,
        cacheInvalidationTags: [
            `Tenant:${cmd.tenantId}`,
            `Principal:${existing.grantedTo}`,
            `BreakGlassGrant:${cmd.grantId}`,
        ],
        retentionTag: BREAK_GLASS_RETENTION_TAG,
        payload: {
            grantId: cmd.grantId,
            issuedBy: existing.issuedBy,
            deniedBy: cmd.deniedBy,
            ...(cmd.reason !== undefined ? { reason: cmd.reason } : {}),
        },
    };
    const stored = await eventStore.append(envelope);
    envelope.eventId = stored.eventId;
    envelope.seq = stored.seq;
    return { envelope, document: next };
}
// =====================================================================
// Action — emitted alongside any action authorized by an active grant.
// =====================================================================
export interface BreakGlassActionCommand {
    tenantId: string;
    correlationId: string;
    grantId: string;
    grantedTo: string;
    actionId: string;
    resourceType?: string;
    resourceId?: string;
}
export interface BreakGlassActionResult {
    envelope: EventEnvelope;
}
export async function handleBreakGlassAction(cmd: BreakGlassActionCommand, eventStore: EventStore): Promise<BreakGlassActionResult> {
    const occurredAt = new Date().toISOString();
    const envelope: EventEnvelope = {
        eventId: newEventId(),
        eventType: 'Authorization.BreakGlassAction',
        schemaId: 'domain.authorization.break_glass_action.v1',
        schemaVersion: 1,
        occurredAt,
        tenantId: cmd.tenantId,
        correlationId: cmd.correlationId,
        idempotencyKey: `authz.break_glass.action.${cmd.grantId}.${cmd.correlationId}`,
        causationId: null,
        principalId: cmd.grantedTo,
        userId: null,
        cacheInvalidationTags: [
            `Tenant:${cmd.tenantId}`,
            `BreakGlassGrant:${cmd.grantId}`,
        ],
        retentionTag: BREAK_GLASS_RETENTION_TAG,
        payload: {
            grantId: cmd.grantId,
            grantedTo: cmd.grantedTo,
            actionId: cmd.actionId,
            ...(cmd.resourceType !== undefined
                ? { resourceType: cmd.resourceType }
                : {}),
            ...(cmd.resourceId !== undefined ? { resourceId: cmd.resourceId } : {}),
        },
    };
    const stored = await eventStore.append(envelope);
    envelope.eventId = stored.eventId;
    envelope.seq = stored.seq;
    return { envelope };
}
// =====================================================================
// Revoke / Expire — both terminate an active grant.
// =====================================================================
export interface BreakGlassRevokeCommand {
    tenantId: string;
    correlationId: string;
    grantId: string;
    revokedBy: string;
    reason: BreakGlassEndReason;
}
export interface BreakGlassRevokeResult {
    envelope: EventEnvelope;
    document: BreakGlassGrantDocument;
}
export async function handleBreakGlassRevoke(cmd: BreakGlassRevokeCommand, eventStore: EventStore, entities: EntityStore): Promise<BreakGlassRevokeResult> {
    const existing = await getBreakGlassGrantEntity(entities, cmd.tenantId, cmd.grantId);
    if (!existing) {
        throw new IdentityError(codes.BREAK_GLASS_GRANT_NOT_FOUND, 'break-glass grant not found', 404);
    }
    if (existing.status !== 'active' && existing.status !== 'pending_approval') {
        throw new IdentityError(codes.BREAK_GLASS_NOT_ACTIVE, `grant in status ${existing.status}`, 409);
    }
    const occurredAt = new Date().toISOString();
    const status: BreakGlassGrantDocument['status'] = cmd.reason === 'auto_expired' ? 'expired' : 'revoked';
    const next: BreakGlassGrantDocument = {
        ...existing,
        status,
        endedAt: occurredAt,
        endReason: cmd.reason,
        ...(status === 'revoked' ? { revokedBy: cmd.revokedBy } : {}),
    };
    await putBreakGlassGrantEntity(entities, next);
    const envelope: EventEnvelope = {
        eventId: newEventId(),
        eventType: cmd.reason === 'auto_expired'
            ? 'Authorization.BreakGlassExpired'
            : 'Authorization.BreakGlassRevoked',
        schemaId: cmd.reason === 'auto_expired'
            ? 'domain.authorization.break_glass_expired.v1'
            : 'domain.authorization.break_glass_revoked.v1',
        schemaVersion: 1,
        occurredAt,
        tenantId: cmd.tenantId,
        correlationId: cmd.correlationId,
        idempotencyKey: `authz.break_glass.${cmd.reason}.${cmd.grantId}`,
        causationId: null,
        principalId: cmd.revokedBy,
        userId: null,
        cacheInvalidationTags: [
            `Tenant:${cmd.tenantId}`,
            `Principal:${existing.grantedTo}`,
            `BreakGlassGrant:${cmd.grantId}`,
        ],
        retentionTag: BREAK_GLASS_RETENTION_TAG,
        payload: {
            grantId: cmd.grantId,
            grantedTo: existing.grantedTo,
            revokedBy: cmd.revokedBy,
            reason: cmd.reason,
        },
    };
    const stored = await eventStore.append(envelope);
    envelope.eventId = stored.eventId;
    envelope.seq = stored.seq;
    return { envelope, document: next };
}
/**
 * Resolves the active grants currently in effect for a principal.
 * Filters out pending / expired / revoked grants and clamps to those whose
 * wall-clock has not passed `expiresAt`.
 */
export async function resolveActiveGrants(entities: EntityStore, tenantId: string, grantedTo: string): Promise<BreakGlassGrantDocument[]> {
    const rows = await entities.query<BreakGlassGrantDocument>(tenantId, 'BreakGlassGrant', { attrsEqual: { grantedTo, status: 'active' } });
    const now = Date.now();
    return rows
        .map(function (r) {
        return r.attrs;
    })
        .filter(function (g) {
        return new Date(g.expiresAt).getTime() > now;
    });
}
