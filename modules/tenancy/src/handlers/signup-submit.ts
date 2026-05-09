/**
 * `Tenancy.Signup.Submit` handler.
 *
 * Public-facing — invoked from the unauthenticated `POST /api/v1/signup`
 * route. Records the request in the control-plane queue. Idempotent on
 * `(email, tenantSlug)` via the unique index in
 * `00000004_tenancy_signup.sql`.
 *
 * No event-store hop: the projection (`control_plane.signup_requests`)
 * lives in the control plane, where there is no per-tenant event store.
 * The audit story for cross-tenant operations is the future
 * `_platform` event store; for the slice the SignupRequestStore row +
 * the structured "signup.submitted" log line are the audit trail.
 */

import type { Logger } from '@atlas/platform-core';
import type { SignupRequestStore } from '@atlas/ports';
import { TenancyError, codes } from '../errors.ts';
import {
  isValidTenantSlug,
  newSignupRequestId,
} from '../ids.ts';
import type {
  SignupSubmitCommand,
  SignupSubmitResult,
} from '../types.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SignupSubmitDeps {
  signupRequests: SignupRequestStore;
  logger?: Logger;
}

export async function handleSignupSubmit(
  cmd: SignupSubmitCommand,
  deps: SignupSubmitDeps,
): Promise<SignupSubmitResult> {
  const email = cmd.email.trim().toLowerCase();
  const tenantSlug = cmd.tenantSlug.trim().toLowerCase();
  const organizationName = cmd.organizationName.trim();

  if (!EMAIL_RE.test(email)) {
    throw new TenancyError(codes.SIGNUP_INVALID, 'invalid email', 400);
  }
  if (!isValidTenantSlug(tenantSlug)) {
    throw new TenancyError(
      codes.SIGNUP_INVALID,
      'tenantSlug must be 1-63 chars, lowercase alnum and hyphen, alnum start and end',
      400,
    );
  }
  if (organizationName.length === 0 || organizationName.length > 200) {
    throw new TenancyError(
      codes.SIGNUP_INVALID,
      'organizationName must be 1-200 chars',
      400,
    );
  }

  const signupId = newSignupRequestId();
  const created = await deps.signupRequests.create({
    signupId,
    email,
    tenantSlug,
    organizationName,
    correlationId: cmd.correlationId,
  });
  // The store collapses retries onto the existing row by `(email, slug)`.
  // We can detect that without a second SELECT: the row's signupId
  // differs from the one we just minted.
  const preexisting = created.signupId !== signupId;

  deps.logger?.info('Signup submitted', {
    event: 'tenancy.signup.submitted',
    properties: {
      signupId: created.signupId,
      email,
      tenantSlug,
      organizationName,
      preexisting,
    },
  });

  return { signup: created, preexisting };
}
