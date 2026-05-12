/**
 * `Tenancy.Signup.Approve` handler — the centerpiece of the slice.
 *
 * Choreography (idempotent at each step):
 *   1. Load the signup row; refuse if missing or already terminal.
 *   2. Insert `control_plane.tenants` row (status=active). If it
 *      already exists (idempotent retry), reuse.
 *   3. Register the custom domain `<slug>.<apex>`.
 *   4. Provision the tenant DB + run migrations (route-supplied
 *      callback; modules don't construct adapters).
 *   5. Revoke any outstanding magic-link invites for this signup's
 *      email (route-supplied). On a retry after a previous attempt
 *      had already minted a token, this step makes "the previous
 *      token is unused" actually true — the prior InviteToken is
 *      neutered before we mint a fresh one. (I3 idempotency fix.)
 *   6. Mint the magic-link invite via the route-supplied
 *      `issueInvite` callback (which wraps `Identity.Invite.Issue`
 *      against the new tenant's per-tenant adapters).
 *   7. Compose the email body around the magic link and dispatch via
 *      `Mailer`.
 *   8. Flip the signup row to `approved`.
 *   9. Emit `Tenancy.SignupApproved` to the per-tenant EventStore so
 *      the audit log + cache-invalidation chain fire. The event tags
 *      `Tenant:${tenantId}` and `Signup:${signupId}` so any cached
 *      pending-signup queries are purged (Invariant I10).
 *
 * If step 2 or 3 was already done by a previous attempt (e.g. a crash
 * between provisioning and mailing), retrying is safe: tenant.create
 * is wrapped in an existence check, customDomains.add throws on the
 * duplicate-hostname index which we catch + tolerate, and step 5
 * revokes any prior magic-link invite before step 6 mints a new one.
 */

import type { EventEnvelope, Logger } from '@atlas/platform-core';
import type {
  CustomDomainStore,
  Mailer,
  SignupRequestStore,
  TenantStore,
} from '@atlas/ports';
import { TenancyError, codes } from '../errors.ts';
import { newEventId, tenantHostnameFor } from '../ids.ts';
import {
  TENANCY_SIGNUP_APPROVED_EVENT_TYPE,
  TENANCY_SIGNUP_APPROVED_SCHEMA_ID,
  TENANCY_SIGNUP_APPROVED_SCHEMA_VERSION,
  type SignupApproveCommand,
  type SignupApproveResult,
  type TenancySignupApprovedPayload,
} from '../types.ts';

export interface SignupApproveDeps {
  signupRequests: SignupRequestStore;
  tenants: TenantStore;
  customDomains: CustomDomainStore;
  mailer: Mailer;
  /**
   * Append the `Tenancy.SignupApproved` audit event into the
   * newly-provisioned tenant's event store. Implemented as a callback
   * (rather than a `EventStore` instance) because the per-tenant SQL
   * pool is only resolvable after `ensureTenantProvisioned` runs —
   * the route can't construct a real `EventStore` upfront. The callback
   * pattern matches `issueInvite` for the same reason.
   */
  appendEvent: (envelope: EventEnvelope) => Promise<void>;
  /**
   * Apex domain for the tenant's hostname (e.g. `localhost` in dev so
   * tenants land on `acme.localhost:3000`). Production deployments pass
   * the configured apex.
   */
  apexDomain: string;
  /**
   * Run tenant DB migrations + reconcile indexes. Idempotent (cached by
   * `state.migratedTenants`). Provided by the route layer.
   */
  ensureTenantProvisioned: (tenantId: string) => Promise<void>;
  /**
   * Revoke any outstanding magic-link InviteTokens for this email in
   * the new tenant before a fresh one is minted. Without this, a
   * crash between `issueInvite` and `markApproved` would leave the
   * previous token live for its full TTL (~7d) — the user would end
   * up with multiple valid magic links from the same approval flow,
   * which contradicts the "previous token is unused" line in the
   * capability spec. The callback is supplied by the route layer
   * (which knows how to enumerate the per-tenant invite-token store
   * and flip outstanding rows to `revoked`).
   *
   * MUST be idempotent: on first approval no invites exist and the
   * callback is a no-op.
   */
  revokeOutstandingInvites: (input: {
    tenantId: string;
    email: string;
    correlationId: string;
  }) => Promise<void>;
  /**
   * Mint a magic-link invite for the new tenant's admin. Wraps
   * `Identity.Invite.Issue` against the per-tenant event store +
   * dispatches the `Identity.InviteIssued` event so the InviteToken
   * projection lands. Returns the plaintext token for the link.
   */
  issueInvite: (input: {
    tenantId: string;
    email: string;
    correlationId: string;
  }) => Promise<{ plaintextToken: string }>;
  /**
   * Build the URL the user clicks in the magic-link email. Defaults to
   * `http://<hostname>:3000/signup/confirm?token=<token>&email=<email>`
   * — the route layer overrides for prod scheme/port.
   */
  buildMagicLinkUrl: (input: {
    tenantId: string;
    hostname: string;
    presentedToken: string;
    acceptedEmail: string;
  }) => string;
  logger?: Logger;
}

export async function handleSignupApprove(
  cmd: SignupApproveCommand,
  deps: SignupApproveDeps,
): Promise<SignupApproveResult> {
  const signup = await deps.signupRequests.get(cmd.signupId);
  if (!signup) {
    throw new TenancyError(
      codes.SIGNUP_NOT_FOUND,
      `signup not found: ${cmd.signupId}`,
      404,
    );
  }
  if (signup.status !== 'pending') {
    throw new TenancyError(
      codes.SIGNUP_NOT_PENDING,
      `signup is ${signup.status}`,
      409,
    );
  }

  const tenantId = signup.tenantSlug;
  const hostname = tenantHostnameFor(signup.tenantSlug, deps.apexDomain);

  // 1. Tenant row. Idempotent: if it already exists, reuse.
  let tenant = await deps.tenants.get(tenantId);
  if (!tenant) {
    try {
      tenant = await deps.tenants.create({
        tenantId,
        name: signup.organizationName,
        status: 'active',
      });
    } catch (e) {
      // The unique constraint on `tenant_id` PK means a concurrent
      // approver could have created the row between our get and
      // create. Re-read; if it's there now, proceed.
      tenant = await deps.tenants.get(tenantId);
      if (!tenant) {
        throw new TenancyError(
          codes.TENANT_ALREADY_EXISTS,
          `tenant create failed: ${e instanceof Error ? e.message : String(e)}`,
          409,
        );
      }
    }
  }

  // 2. Custom domain. Idempotent: if already registered for this
  // tenant, accept; if registered for a different tenant, reject.
  const existingDomain = await deps.customDomains.getByHostname(hostname);
  if (existingDomain && existingDomain.tenantId !== tenantId) {
    throw new TenancyError(
      codes.CUSTOM_DOMAIN_TAKEN,
      `hostname ${hostname} already registered to a different tenant`,
      409,
    );
  }
  if (!existingDomain) {
    await deps.customDomains.add({
      hostname,
      tenantId,
      isPrimary: true,
    });
  }

  // 3. Provision the tenant DB. Route-supplied — we don't touch
  // adapters from inside the module.
  await deps.ensureTenantProvisioned(tenantId);

  // 4. Revoke any outstanding magic-link invites for this email.
  // First-time approval: no-op. Retry after a prior crash between
  // mint and markApproved: the prior token is invalidated here so a
  // fresh mint below does not leave two live magic links to the same
  // mailbox. (I3 idempotency fix.)
  await deps.revokeOutstandingInvites({
    tenantId,
    email: signup.email,
    correlationId: cmd.correlationId,
  });

  // 5. Mint the magic-link invite in the tenant's per-tenant DB.
  const { plaintextToken } = await deps.issueInvite({
    tenantId,
    email: signup.email,
    correlationId: cmd.correlationId,
  });

  // 6. Compose + send the email.
  const magicLinkUrl = deps.buildMagicLinkUrl({
    tenantId,
    hostname,
    presentedToken: plaintextToken,
    acceptedEmail: signup.email,
  });
  const subject = `Welcome to ${signup.organizationName} — confirm your account`;
  const body =
    `Hi,\n\n` +
    `${signup.organizationName} on Atlas is ready. Click the link below to ` +
    `set up your account and sign in:\n\n` +
    `${magicLinkUrl}\n\n` +
    `This link expires in 7 days. If you didn't request this, ignore the email.\n`;
  await deps.mailer.send({
    to: signup.email,
    subject,
    body,
    tenantId,
    correlationId: cmd.correlationId,
    tags: ['magic-link', 'signup-approved'],
  });

  // 7. Flip the signup row to approved. Done after the mail-dispatch
  // so a crash before send doesn't strand an "approved" row whose
  // email never went out.
  const approved = await deps.signupRequests.markApproved(
    cmd.signupId,
    tenantId,
  );

  // 8. Emit the audit event into the new tenant's event store so the
  // dispatcher chain runs (cache invalidation + SSE fanout). The
  // magic-link plaintext is NEVER on the payload — secrets stay out
  // of event history (mirrors the rule in `events.md`).
  const occurredAt = new Date().toISOString();
  const payload: TenancySignupApprovedPayload = {
    signupId: approved.signupId,
    tenantId,
    hostname,
    email: signup.email,
    principalId: cmd.principalId,
    organizationName: signup.organizationName,
  };
  const envelope: EventEnvelope = {
    eventId: newEventId(),
    eventType: TENANCY_SIGNUP_APPROVED_EVENT_TYPE,
    schemaId: TENANCY_SIGNUP_APPROVED_SCHEMA_ID,
    schemaVersion: TENANCY_SIGNUP_APPROVED_SCHEMA_VERSION,
    occurredAt,
    tenantId,
    correlationId: cmd.correlationId,
    idempotencyKey: `tenancy.signup.approve.${approved.signupId}`,
    causationId: null,
    principalId: cmd.principalId,
    userId: null,
    cacheInvalidationTags: [
      `Tenant:${tenantId}`,
      `Signup:${approved.signupId}`,
    ],
    payload,
  };
  await deps.appendEvent(envelope);

  // Structured log — useful for grep-ability in dev / staging stdout
  // streaming. The audit-of-record lives on the event envelope above;
  // this line is informational only.
  deps.logger?.info('Signup approved', {
    event: 'tenancy.signup.approved',
    properties: {
      signupId: approved.signupId,
      tenantId,
      hostname,
      email: signup.email,
      principalId: cmd.principalId,
    },
  });

  return {
    signup: approved,
    tenant,
    hostname,
    magicLinkToken: plaintextToken,
    magicLinkUrl,
  };
}
