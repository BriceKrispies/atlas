/**
 * Identity event dispatcher.
 *
 * Persists `Identity.*` event payloads to entities + relations.
 * Cache-tag invalidation lives in the wiring layer's
 * `cacheTagDispatcher` — do not call cache here.
 *
 * Storage model:
 *   - User      → entities (`tenantId=PLATFORM_TENANT_ID`, type='User')
 *   - Membership→ entities (`tenantId=<tenant>`, type='Membership')
 *                 plus a `membership.user` edge in relations
 *   - InviteToken → entities (`tenantId=<tenant>`, type='InviteToken')
 *                   plus optional `invite.user` edge on accept
 *
 * **Typed-envelope contract.** Envelopes are narrowed to
 * `IdentityEventEnvelope` (see `./events.ts`) via the `isIdentityEvent`
 * type guard. After narrowing each `switch` arm receives the
 * specific payload shape — no `payload as Record<string, unknown>`,
 * no `document as XDocument` cast ladder, and no runtime
 * "no payload.document — handler emit-site bug" throw: events that
 * legitimately carry no document declare a payload shape that doesn't
 * have one, so the cases that lack a `document` field simply don't
 * reach for it.
 */
import type { EventEnvelope, Logger } from '@atlas/platform-core';
import type { Cache, EntityStore, EventDispatcher, RelationStore, } from '@atlas/ports';
import { putUserEntity } from './entities/user.ts';
import { putMembershipEntity } from './entities/membership.ts';
import { putInviteTokenEntity } from './entities/invite-token.ts';
import { putSessionEntity } from './entities/auth-session.ts';
import { putApiKeyEntity } from './entities/api-key.ts';
import { putServicePrincipalEntity } from './entities/service-principal.ts';
import { putOAuthTokenEntity } from './entities/oauth-token.ts';
import { putIdentityProviderEntity } from './entities/identity-provider.ts';
import { putScimTokenEntity } from './entities/scim-token.ts';
import { putAuditExportConfig } from './entities/audit-export-config.ts';
import { putAuthFactorEntity } from './entities/auth-factor.ts';
import { putMfaBypassEntity } from './entities/mfa-bypass.ts';
import { putRecoveryCodeEntity } from './entities/recovery-code.ts';
import { putSamlSpKeyEntity } from './entities/saml-sp-key.ts';
import { linkInviteToUser, linkMembershipToUser, } from './entities/relations.ts';
import { isIdentityEvent, type IdentityEventEnvelope } from './events.ts';
export interface IdentityDispatchContext {
    entities: EntityStore;
    relations: RelationStore;
    cache?: Cache;
    /**
     * Optional logger for per-event debug breadcrumbs. Carried through
     * the wiring layer when available; absent in tests / sim. The
     * dispatcher emits one `Identity.Dispatch.Ran` debug line per
     * dispatched event so operators can trace projection rebuilds.
     */
    logger?: Logger;
}
export async function dispatchIdentityEvent(envelope: EventEnvelope, ctx: IdentityDispatchContext): Promise<void> {
    // Type-guard narrows the wide `EventEnvelope` to the typed
    // discriminated union. Events outside the union (e.g.
    // `Identity.LoginRejected` audit events, anything in another
    // domain) early-return without touching projections.
    if (!isIdentityEvent(envelope))
        return;
    // Single debug breadcrumb per dispatched event. Logger is opt-in
    // via the context — sim / unit tests pass nothing and stay silent.
    ctx.logger?.debug('identity dispatcher ran', {
        event: 'Identity.Dispatch.Ran',
        properties: {
            eventType: envelope.eventType,
            eventId: envelope.eventId,
        },
    });
    await dispatchTypedIdentityEvent(envelope, ctx);
}
/**
 * Exhaustive switch over the typed `IdentityEventEnvelope` union.
 *
 * The `_exhaustive: never` arm is the compile-time safety net: when
 * a new event variant is added to the union, this switch fails to
 * type-check until the corresponding `case` lands here. That replaces
 * the previous runtime `EVENTS_WITHOUT_DOCUMENT` allow-list +
 * "no payload.document — emit-site bug" throw.
 */
async function dispatchTypedIdentityEvent(envelope: IdentityEventEnvelope, ctx: IdentityDispatchContext): Promise<void> {
    switch (envelope.eventType) {
        // ----- Phase A1 — users + memberships + invites -----------------
        case 'Identity.UserCreated':
        case 'Identity.UserUpdated':
        case 'Identity.AccountLocked':
        case 'Identity.PasswordChanged': {
            // All four event types carry the same merged-User payload shape.
            // The event-type discrimination lives at the *audit* layer (event
            // log carries the semantic event); the dispatcher just persists.
            await putUserEntity(ctx.entities, envelope.payload.document, envelope.tenantId);
            return;
        }
        case 'Identity.MembershipCreated': {
            const m = envelope.payload.document;
            await putMembershipEntity(ctx.entities, m);
            await linkMembershipToUser(ctx.relations, m.tenantId, m.userId);
            return;
        }
        case 'Identity.MembershipRolesChanged': {
            // A3.7: roles reconciled from JWT group claim. Just upsert the
            // merged document; the relation is unchanged.
            await putMembershipEntity(ctx.entities, envelope.payload.document);
            return;
        }
        case 'Identity.InviteIssued': {
            await putInviteTokenEntity(ctx.entities, envelope.payload.document);
            return;
        }
        case 'Identity.InviteAccepted': {
            const t = envelope.payload.document;
            await putInviteTokenEntity(ctx.entities, t);
            if (t.acceptedUserId) {
                await linkInviteToUser(ctx.relations, t.tenantId, t.tokenId, t.acceptedUserId);
            }
            return;
        }
        // ----- Phase A2 — sessions --------------------------------------
        case 'Identity.SessionIssued':
        case 'Identity.SessionRefreshed':
        case 'Identity.SessionEnded':
        case 'Identity.SessionMfaSatisfied': {
            // All four carry the merged AuthSession document; the dispatcher
            // just persists. Status discrimination lives at the audit layer.
            await putSessionEntity(ctx.entities, envelope.payload.document);
            return;
        }
        case 'Identity.SessionAnomaly': {
            // Audit-only diagnostic event — refresh-token reuse / suspicious
            // refresh patterns. The corresponding RevokeAllForUser flow emits
            // SessionEnded events that DO carry documents. Nothing to persist.
            return;
        }
        // ----- Phase A2.7-A2.9 — service credentials --------------------
        case 'Identity.ApiKeyCreated':
        case 'Identity.ApiKeyRotated':
        case 'Identity.ApiKeyRevoked': {
            await putApiKeyEntity(ctx.entities, envelope.payload.document);
            return;
        }
        case 'Identity.ServicePrincipalCreated':
        case 'Identity.ServicePrincipalScopesChanged':
        case 'Identity.ServicePrincipalDisabled': {
            await putServicePrincipalEntity(ctx.entities, envelope.payload.document);
            return;
        }
        case 'Identity.OAuthTokenIssued':
        case 'Identity.OAuthTokenRevoked': {
            await putOAuthTokenEntity(ctx.entities, envelope.payload.document);
            return;
        }
        // ----- Phase A3 — federated OIDC --------------------------------
        case 'Identity.IdentityProviderConfigured':
        case 'Identity.IdentityProviderActivated':
        case 'Identity.IdentityProviderDisabled':
        case 'Identity.IdentityProviderRotatedJwks': {
            await putIdentityProviderEntity(ctx.entities, envelope.payload.document);
            return;
        }
        // ----- Phase A4 — SCIM tokens + audit export --------------------
        case 'Identity.ScimTokenEnabled':
        case 'Identity.ScimTokenRotated':
        case 'Identity.ScimTokenRevoked': {
            await putScimTokenEntity(ctx.entities, envelope.payload.document);
            return;
        }
        case 'Identity.AuditExportConfigured':
        case 'Identity.AuditExportActivated':
        case 'Identity.AuditExportDisabled': {
            // AuditExport Configured / Activated / Disabled. Run-level
            // events come from the worker (A4.9) and bypass this dispatcher.
            await putAuditExportConfig(ctx.entities, envelope.payload.document);
            return;
        }
        // ----- Phase A5 — MFA stack -------------------------------------
        case 'Identity.AuthFactorEnrolled':
        case 'Identity.AuthFactorRevoked':
        case 'Identity.MfaChallengeSucceeded':
        case 'Identity.MfaAnomaly':
        case 'Identity.MfaLockout': {
            // All five factor-touching events carry the merged AuthFactor
            // document. RecoveryCode + MfaBypass are separate entities; their
            // dispatcher branches land below.
            await putAuthFactorEntity(ctx.entities, envelope.payload.document);
            return;
        }
        case 'Identity.RecoveryCodesGenerated':
        case 'Identity.RecoveryCodesRegenerated': {
            // Batch-metadata events — handlers eager-write the per-code rows,
            // so the dispatcher has nothing extra to persist from the event.
            return;
        }
        case 'Identity.RecoveryCodeConsumed': {
            // Per-code event with a single document. RecoveryCodesGenerated /
            // Regenerated emit batch metadata (no `document`) — the handler
            // eager-writes the per-code rows since we can't reconstruct them
            // from the batch event alone.
            await putRecoveryCodeEntity(ctx.entities, envelope.payload.document);
            return;
        }
        case 'Identity.MfaBypassIssued':
        case 'Identity.MfaBypassUsed': {
            await putMfaBypassEntity(ctx.entities, envelope.payload.document);
            return;
        }
        // ----- Phase A6 — SAML SP key lifecycle -------------------------
        case 'Identity.SamlSpKeyGenerated':
        case 'Identity.SamlSpKeyRotated': {
            await putSamlSpKeyEntity(ctx.entities, envelope.payload.document);
            return;
        }
        default: {
            // Compile-time exhaustiveness check. When a new variant is
            // added to `IdentityEventEnvelope`, this assignment fails to
            // type-check until the corresponding `case` lands above. That
            // replaces the previous runtime "no payload.document — emit-site
            // bug" throw with a build-time gate.
            const _exhaustive: never = envelope;
            return _exhaustive;
        }
    }
}
/**
 * Factory: bind an `IdentityDispatchContext` and return an
 * `EventDispatcher`. Designed for `composeDispatchers`.
 */
export function identityDispatcher(ctx: IdentityDispatchContext): EventDispatcher {
    return function (envelope) {
        return dispatchIdentityEvent(envelope, ctx);
    };
}
