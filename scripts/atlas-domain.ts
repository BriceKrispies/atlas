#!/usr/bin/env tsx
/**
 * atlas-domain — stub-mode operator CLI for custom domains.
 *
 * Connects directly to `CONTROL_PLANE_DB_URL` and reads/writes
 * `control_plane.custom_domains`. No DNS check, no cert issuance — the
 * operator is trusted (same posture as `atlasctl tenant create`).
 *
 * When the real verification + cert flow ships, this script grows a
 * `verify` subcommand and the `add` subcommand starts rows in `pending`
 * instead of `active`. See
 * `specs/domains/tenancy/capabilities/custom-domains/README.md`.
 *
 * Usage:
 *   pnpm domain:add <tenant-id> <hostname> [--primary]
 *   pnpm domain:list [<tenant-id>]
 *   pnpm domain:disable <hostname>
 */
import postgres from 'postgres';
import { PostgresCustomDomainStore, runMigrations, } from '../adapters/node/src/index.ts';
import { normalizeHost } from '../packages/platform-core/src/index.ts';
interface AddOpts {
    tenantId: string;
    hostname: string;
    primary: boolean;
}
function usage(): never {
    process.stderr.write([
        'usage:',
        '  pnpm domain:add <tenant-id> <hostname> [--primary]',
        '  pnpm domain:list [<tenant-id>]',
        '  pnpm domain:disable <hostname>',
        '',
        'Requires CONTROL_PLANE_DB_URL.',
        '',
    ].join('\n'));
    process.exit(2);
}
function parseAdd(rest: string[]): AddOpts {
    if (rest.length < 2)
        usage();
    const [tenantId, hostname, ...flags] = rest;
    if (!tenantId || !hostname)
        usage();
    const primary = flags.includes('--primary');
    return { tenantId, hostname: normalizeHost(hostname), primary };
}
async function withSql<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
    const url = process.env['CONTROL_PLANE_DB_URL'];
    if (!url) {
        process.stderr.write('CONTROL_PLANE_DB_URL not set\n');
        process.exit(2);
    }
    const sql = postgres(url, { max: 2 });
    try {
        // Idempotent — re-runs are no-ops once the table exists.
        await runMigrations(sql, 'control-plane');
        return await fn(sql);
    }
    finally {
        await sql.end({ timeout: 5 });
    }
}
async function cmdAdd(rest: string[]): Promise<void> {
    const opts = parseAdd(rest);
    await withSql(async function (sql) {
        const store = new PostgresCustomDomainStore(sql);
        const row = await store.add({
            hostname: opts.hostname,
            tenantId: opts.tenantId,
            isPrimary: opts.primary,
        });
        process.stdout.write(`added: ${row.hostname} → tenant=${row.tenantId} primary=${row.isPrimary}\n`);
    });
}
async function cmdList(rest: string[]): Promise<void> {
    const tenantId = rest[0];
    await withSql(async function (sql) {
        if (tenantId) {
            const store = new PostgresCustomDomainStore(sql);
            const rows = await store.list(tenantId);
            if (rows.length === 0) {
                process.stdout.write(`(no custom domains for tenant=${tenantId})\n`);
                return;
            }
            for (const r of rows) {
                const flag = r.isPrimary ? ' [primary]' : '';
                process.stdout.write(`  ${r.hostname} (${r.status})${flag}\n`);
            }
        }
        else {
            // No tenant filter — dump everything. Operator-only path; fine to
            // bypass the port and read directly.
            const rows = await sql<Array<{
                hostname: string;
                tenant_id: string;
                status: string;
                is_primary: boolean;
            }>> `
        SELECT hostname, tenant_id, status, is_primary
        FROM control_plane.custom_domains
        ORDER BY tenant_id, is_primary DESC, hostname
      `;
            if (rows.length === 0) {
                process.stdout.write('(no custom domains registered)\n');
                return;
            }
            for (const r of rows) {
                const flag = r.is_primary ? ' [primary]' : '';
                process.stdout.write(`  ${r.tenant_id}  ${r.hostname} (${r.status})${flag}\n`);
            }
        }
    });
}
async function cmdDisable(rest: string[]): Promise<void> {
    const hostname = rest[0];
    if (!hostname)
        usage();
    await withSql(async function (sql) {
        const store = new PostgresCustomDomainStore(sql);
        await store.disable(normalizeHost(hostname));
        process.stdout.write(`disabled: ${hostname}\n`);
    });
}
const [, , subcommand, ...rest] = process.argv;
switch (subcommand) {
    case 'add':
        await cmdAdd(rest);
        break;
    case 'list':
        await cmdList(rest);
        break;
    case 'disable':
        await cmdDisable(rest);
        break;
    default:
        usage();
}
