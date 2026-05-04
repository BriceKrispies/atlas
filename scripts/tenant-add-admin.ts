#!/usr/bin/env tsx
/**
 * Bootstrap script: mint a TenantAdmin invite for a tenant.
 *
 * Usage:
 *   pnpm tsx scripts/tenant-add-admin.ts <tenantId> <email>
 *   pnpm tenant:add-admin -- <tenantId> <email>
 *
 * Env:
 *   CONTROL_PLANE_DB_URL — required
 *
 * What it does (Phase A1):
 *   1. Verifies the tenant exists (`control_plane.tenants` row).
 *   2. Ensures tenant-DB migrations are applied + entity-table indexes
 *      reconciled.
 *   3. Calls `Identity.Invite.Issue` end-to-end (handler → event store →
 *      dispatcher → entity write) so the audit log is identical to a
 *      regular issue. Operator id surfaces on the event as
 *      `_atlasctl_bootstrap`.
 *   4. Prints the plaintext token + the accept URL template.
 *
 * The plaintext is shown EXACTLY ONCE. Re-running yields a fresh token
 * (the prior pending invite stays pending and lapses on TTL).
 *
 * This is the Phase A1 cut. The full HTTP-based atlasctl
 * (specs/crosscut/atlasctl.md) is a later refinement; for bootstrap a
 * direct DB-side script avoids the chicken-and-egg of "you need an
 * admin to create the first admin."
 */

import postgres from 'postgres';
import {
  PostgresEntityStore,
  PostgresEventStore,
  PostgresRelationStore,
  PostgresTenantDbProvider,
  runMigrations,
} from '@atlas/adapter-node';
import {
  handleInviteIssue,
  identityDispatcher,
} from '@atlas/identity';

const TENANT_ADMIN_ROLE = 'TenantAdmin';
const INVITE_TTL_SECONDS = 24 * 60 * 60;
const BOOTSTRAP_PRINCIPAL = '_atlasctl_bootstrap';

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function newCorrelationId(): string {
  return `boot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function main(): Promise<void> {
  const [tenantId, email] = process.argv.slice(2);
  if (!tenantId || !email) {
    fail('usage: pnpm tsx scripts/tenant-add-admin.ts <tenantId> <email>');
  }
  const dbUrl = process.env['CONTROL_PLANE_DB_URL'];
  if (!dbUrl) {
    fail('CONTROL_PLANE_DB_URL must be set');
  }

  const controlSql = postgres(dbUrl, { max: 2 });
  try {
    await controlSql`SELECT 1`;

    // Apply control-plane migrations (idempotent) so the script runs
    // cleanly against a freshly-provisioned host.
    await runMigrations(controlSql, 'control-plane');

    // Tenant existence check.
    const rows = await controlSql<Array<{ tenant_id: string; status: string }>>`
      SELECT tenant_id, status FROM control_plane.tenants WHERE tenant_id = ${tenantId}
    `;
    if (rows.length === 0) {
      fail(`tenant not found: ${tenantId}`);
    }
    if (rows[0]?.status !== 'active') {
      fail(`tenant ${tenantId} is in status ${rows[0]?.status} (need 'active')`);
    }

    // Open the tenant pool + run tenant migrations.
    const tenantDb = new PostgresTenantDbProvider(controlSql);
    const tenantSql = await tenantDb.getPool(tenantId);
    await runMigrations(tenantSql, 'tenant');

    const eventStore = new PostgresEventStore(tenantSql);
    const entities = new PostgresEntityStore(tenantSql);
    const relations = new PostgresRelationStore(tenantSql);

    const correlationId = newCorrelationId();
    const result = await handleInviteIssue(
      {
        tenantId,
        correlationId,
        principalId: BOOTSTRAP_PRINCIPAL,
        email,
        rolesOnAccept: [TENANT_ADMIN_ROLE],
        ttlSeconds: INVITE_TTL_SECONDS,
      },
      eventStore,
    );

    // Apply the projection synchronously — the operator wants the
    // entity present before the script returns so a follow-up "is the
    // invite there?" query succeeds.
    await identityDispatcher({ entities, relations })(result.envelope);

    process.stdout.write(
      [
        `\n✔ TenantAdmin invite issued`,
        `  tenant      : ${tenantId}`,
        `  email       : ${email}`,
        `  tokenId     : ${result.document.tokenId}`,
        `  expiresAt   : ${result.document.expiresAt}`,
        `  rolesOnAccept: ${result.document.rolesOnAccept.join(', ')}`,
        ``,
        `Plaintext token (shown ONCE — store it now):`,
        ``,
        `  ${result.plaintextToken}`,
        ``,
        `Have the user POST to /identity/invite/accept with this token to`,
        `complete enrollment. The accept-route lands in Phase A1 #47.`,
        ``,
      ].join('\n'),
    );

    await tenantDb.close();
  } finally {
    await controlSql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  process.stderr.write(`error: ${(e as Error).stack ?? (e as Error).message}\n`);
  process.exit(1);
});
