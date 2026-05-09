/**
 * `Tenancy.Signup.Deny` handler.
 *
 * Marks the signup row `denied` and records the reason. No tenant
 * provisioning, no email — the slice doesn't ship a "sorry" email yet.
 * (Production wiring would dispatch a templated rejection mail here.)
 */

import type { Logger } from '@atlas/platform-core';
import type { SignupRequestStore } from '@atlas/ports';
import { TenancyError, codes } from '../errors.ts';
import type { SignupDenyCommand, SignupDenyResult } from '../types.ts';

export interface SignupDenyDeps {
  signupRequests: SignupRequestStore;
  logger?: Logger;
}

export async function handleSignupDeny(
  cmd: SignupDenyCommand,
  deps: SignupDenyDeps,
): Promise<SignupDenyResult> {
  const reason = cmd.reason.trim();
  if (reason.length === 0 || reason.length > 500) {
    throw new TenancyError(
      codes.SIGNUP_INVALID,
      'reason must be 1-500 chars',
      400,
    );
  }
  const existing = await deps.signupRequests.get(cmd.signupId);
  if (!existing) {
    throw new TenancyError(
      codes.SIGNUP_NOT_FOUND,
      `signup not found: ${cmd.signupId}`,
      404,
    );
  }
  if (existing.status !== 'pending') {
    throw new TenancyError(
      codes.SIGNUP_NOT_PENDING,
      `signup is ${existing.status}`,
      409,
    );
  }

  const signup = await deps.signupRequests.markDenied(cmd.signupId, reason);

  deps.logger?.info('Signup denied', {
    event: 'tenancy.signup.denied',
    properties: {
      signupId: signup.signupId,
      reason,
      principalId: cmd.principalId,
    },
  });

  return { signup };
}
