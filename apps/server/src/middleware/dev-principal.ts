/**
 * Dev-mode principal injection.
 *
 * Specced in `specs/decisions/0015-dev-mode-contract.md` §2. When dev-mode
 * is enabled AND a request arrives with NO auth credentials of any kind,
 * this resolves the request to the seeded `dev-admin` principal so the
 * downstream pipeline (authz, audit, dispatch) runs identically to a
 * properly-authenticated request.
 *
 * Critically: this is NOT auth bypass. The injected principal goes through
 * the same authz seam as any real principal. The dev-admin's `admin` role
 * combined with the seeded permissive policy yields permit. The code path
 * is the same as prod's; the policy bundle is what differs.
 *
 * Lives in its own file (ADR 0015 §"Constraints" #2) so a future hardening
 * pass can tree-shake it out of prod bundles via the ATLAS_PROD_BUILD=1
 * compile-time flag.
 */
import type { Principal } from '@atlas/platform-core';
import type { DevModeConfig } from '../config.ts';

/**
 * Sentinel attribute stamped on every dev-injected principal. Audit code
 * paths surface this as `principalSource: 'dev-injection'` on emitted
 * events (ADR 0015 §3 layer 4 — the operational trip-wire).
 */
export const DEV_INJECTED_PRINCIPAL_SOURCE = 'dev-injection' as const;

/**
 * Return `true` when the request presents no auth credentials at all.
 * If ANY credential is present (cookie, X-Debug-Principal, Authorization
 * bearer/JWT), real auth wins and injection does not fire.
 */
export function noCredentialsPresent(args: {
    authorizationHeader: string | undefined;
    cookieHeader: string | undefined;
    debugPrincipalHeader: string | undefined;
}): boolean {
    if (args.authorizationHeader && args.authorizationHeader.trim().length > 0) {
        return false;
    }
    if (args.debugPrincipalHeader && args.debugPrincipalHeader.trim().length > 0) {
        return false;
    }
    // Cookie presence alone doesn't disqualify (cookies often carry only
    // refresh tokens or CSRF tokens). The cookie SESSION check upstream
    // already tried and failed — if a real session cookie was valid we
    // would never reach this code. So we only block injection when an
    // Atlas session cookie name is visibly present.
    if (args.cookieHeader && /(?:^|;\s*)atlas_session=/i.test(args.cookieHeader)) {
        return false;
    }
    return true;
}

/**
 * Build the dev-admin principal from the resolved DevModeConfig.
 * Caller is expected to gate on `devMode.enabled === true` first.
 */
export function buildDevAdminPrincipal(devMode: DevModeConfig): Principal {
    return {
        principalId: devMode.principalId,
        tenantId: devMode.tenantId,
        userId: devMode.principalId,
        roles: [...devMode.roles],
        attributes: { principalSource: DEV_INJECTED_PRINCIPAL_SOURCE },
    };
}
