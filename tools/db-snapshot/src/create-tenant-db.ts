/**
 * create-tenant-db — recreate a per-tenant database + runtime role from a
 * captured connection snapshot, restoring the password VERBATIM.
 *
 * Crucially does NOT call `provisionTenantDatabase` (that regenerates the
 * password). Verbatim restore means the captured `control_plane.tenants`
 * db_password row stays internally consistent with the role's actual password.
 *
 * Idempotent:
 *   - CREATE DATABASE if absent.
 *   - CREATE ROLE if absent (with captured password); else ALTER ROLE to the
 *     captured password.
 *   - GRANT CONNECT (repeatable no-op).
 *
 * Identifier safety mirrors `tenant-db-provider.ts` (`quoteIdent` /
 * `quoteLiteral`).
 */
import type postgres from 'postgres';
import type { TenantConnectionSnapshot } from './types.ts';

/** Quote a Postgres identifier; rejects anything outside `[a-z0-9_]`. */
export function quoteIdent(ident: string): string {
    if (!/^[a-z0-9_]+$/.test(ident)) {
        throw new Error(`db-snapshot: refusing to quote unsafe identifier: ${ident}`);
    }
    return `"${ident}"`;
}

/** Quote a Postgres string literal by doubling single quotes. */
export function quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Recreate the database + runtime role for a captured tenant connection.
 * `superSql` must be a privileged (superuser) control-plane connection.
 * `overrideDbName` lets a round-trip test redirect to a scratch DB name while
 * keeping the captured role/password.
 */
export async function createTenantDb(
    superSql: postgres.Sql,
    conn: TenantConnectionSnapshot,
    overrideDbName?: string,
): Promise<{ dbName: string; role: string; created: boolean }> {
    const dbName = overrideDbName ?? conn.dbName;
    const role = conn.dbUser;

    // --- Role: create with verbatim password, or reset to it. ---
    const roleExists = await superSql<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ${role}) AS exists
  `;
    if (roleExists[0]?.exists !== true) {
        await superSql.unsafe(
            `CREATE ROLE ${quoteIdent(role)} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD ${quoteLiteral(conn.dbPassword)}`,
        );
    } else {
        await superSql.unsafe(
            `ALTER ROLE ${quoteIdent(role)} WITH PASSWORD ${quoteLiteral(conn.dbPassword)}`,
        );
    }

    // --- Database: create if absent. ---
    const dbExists = await superSql<{ exists: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${dbName}) AS exists
  `;
    const created = dbExists[0]?.exists !== true;
    if (created) {
        // CREATE DATABASE cannot run inside a transaction; unsafe() with no
        // params runs outside the implicit tx wrapper.
        await superSql.unsafe(`CREATE DATABASE ${quoteIdent(dbName)}`);
    }

    // --- Grant CONNECT (idempotent). ---
    await superSql.unsafe(
        `GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(role)}`,
    );

    return { dbName, role, created };
}

/**
 * Replay the CRUD grants the provisioner sets up for the runtime role, run
 * against the tenant DB as the provisioner. Mirrors the grant block in
 * `tenant-db-provider.ts` (~527-531).
 */
export async function replayGrants(tenantSql: postgres.Sql, role: string): Promise<void> {
    await tenantSql.unsafe(`GRANT USAGE ON SCHEMA public TO ${quoteIdent(role)}`);
    await tenantSql.unsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${quoteIdent(role)}`,
    );
    await tenantSql.unsafe(
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdent(role)}`,
    );
    await tenantSql.unsafe(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${quoteIdent(role)}`,
    );
    await tenantSql.unsafe(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${quoteIdent(role)}`,
    );
}
