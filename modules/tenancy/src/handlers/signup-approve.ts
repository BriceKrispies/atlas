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
 *   5. Mint the magic-link invite via the route-supplied
 *      `issueInvite` callback (which wraps `Identity.Invite.Issue`
 *      against the new tenant's per-tenant adapters).
 *   6. Compose the email body around the magic link and dispatch via
 *      `Mailer`.
 *   7. Flip the signup row to `approved`.
 *
 * If step 2 or 3 was already done by a previous attempt (e.g. a crash
 * between provisioning and mailing), retrying is safe: tenant.create
 * is wrapped in an existence check, customDomains.add throws on the
 * duplicate-hostname index which we catch + tolerate, and the magic-
 * link mint is purely additive (a fresh InviteToken per call).
 */

import type {
  CustomDomainStore,
  Mailer,
  SignupRequestStore,
  TenantStore,
} from '@atlas/ports';
import { TenancyError, codes } from '../errors.ts';
import { tenantHostnameFor } from '../ids.ts';
import type {
  SignupApproveCommand,
  SignupApproveResult,
} from '../types.ts';

export interface SignupApproveDeps {
  signupRequests: SignupRequestStore;
  tenants: TenantStore;
  customDomains: CustomDomainStore;
  mailer: Mailer;
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
          `tenant create failed: ${(e as Error).message}`,
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

  // 4. Mint the magic-link invite in the tenant's per-tenant DB.
  const { plaintextToken } = await deps.issueInvite({
    tenantId,
    email: signup.email,
    correlationId: cmd.correlationId,
  });

  // 5. Compose + send the email.
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

  // 6. Flip the signup row to approved. Done last so a crash before
  // mail-dispatch doesn't strand an "approved" row whose email never
  // went out.
  const approved = await deps.signupRequests.markApproved(cmd.signupId, tenantId);

  console.log(
    JSON.stringify({
      event: 'tenancy.signup.approved',
      signupId: approved.signupId,
      tenantId,
      hostname,
      email: signup.email,
      principalId: cmd.principalId,
      correlationId: cmd.correlationId,
    }),
  );

  return {
    signup: approved,
    tenant,
    hostname,
    magicLinkToken: plaintextToken,
    magicLinkUrl,
  };
}
