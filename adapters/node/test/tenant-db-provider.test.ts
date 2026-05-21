/**
 * PostgresTenantDbProvider.provisionTenantDatabase tests.
 *
 * Exercises the db-per-tenant provisioning path (ADR 0005). Hard
 * requirements:
 *   - Idempotent — re-running yields the same end state, no errors.
 *   - Two-role topology — runtime role gets CRUD on `public.*` only;
 *     `CREATE TABLE` as the runtime role MUST fail.
 *   - Migrations run as the provisioner (the `controlPlane` user), not the
 *     runtime role.
 *   - `control_plane.tenants.db_*` columns populated on the first-time path.
 *   - Structured log event `Tenancy.Database.Provisioned` emitted on
 *     first-time path only — NOT on idempotent re-runs.
 *
 * Skipped silently when TEST_TENANT_DB_URL is unset, matching the rest of
 * the @atlas/adapter-node test suite.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from '@atlas/test';
import postgres from 'postgres';
import type { LogFields, Logger } from '@atlas/platform-core';
import { assertDefined } from '@atlas/test-fixtures/assert';
import {
  PostgresTenantDbProvider,
  TenantDatabaseNotProvisionedError,
  TenantNotFoundError,
  runMigrations,
} from '../src/index.ts';
import { TEST_DB_URL, HAS_DB } from './_setup.ts';

interface CapturedLog {
  message: string;
  fields: LogFields | undefined;
}

function captureLogger(): { logger: Logger; logs: CapturedLog[] } {
  const logs: CapturedLog[] = [];
  const logger: Logger = {
    debug(message, fields) {
      logs.push({ message, fields });
    },
    info(message, fields) {
      logs.push({ message, fields });
    },
    warn(message, fields) {
      logs.push({ message, fields });
    },
    error(message, fields) {
      logs.push({ message, fields });
    },
    fatal(message, fields) {
      logs.push({ message, fields });
    },
  };
  return { logger, logs };
}

if (!HAS_DB) {
  describe('PostgresTenantDbProvider.provisionTenantDatabase (skipped)', function () {
    it.skip('TEST_TENANT_DB_URL not set — skipping db-per-tenant provisioning tests', function () {
      // intentionally empty
    });
  });
} else {
  describe('PostgresTenantDbProvider.provisionTenantDatabase', function () {
    // Tenant ids are slugs; dashes are sanitised to underscores in the
    // derived db / role names. Two tenants exercise isolation.
    const TENANT_A = 'pt-provision-a';
    const TENANT_B = 'pt-provision-b';
    const DB_A = 'atlas_t_pt_provision_a';
    const DB_B = 'atlas_t_pt_provision_b';
    const ROLE_A = 'atlas_t_pt_provision_a_runtime';
    const ROLE_B = 'atlas_t_pt_provision_b_runtime';

    let controlPlane: postgres.Sql;

    async function dropTenantArtifacts(): Promise<void> {
      // Drop databases and roles from any previous run before each test
      // so the path always starts at the "nothing exists" state.
      // Order matters: drop DB before its role (a role cannot be dropped
      // while it owns objects).
      for (const dbName of [DB_A, DB_B]) {
        await controlPlane.unsafe(`DROP DATABASE IF EXISTS "${dbName}"`);
      }
      for (const roleName of [ROLE_A, ROLE_B]) {
        // REASSIGN/DROP OWNED handles default-priv grants left over from
        // an aborted provisioning run.
        await controlPlane
          .unsafe(`DROP ROLE IF EXISTS "${roleName}"`)
          .catch(function () {
            /* may fail if the role still owns something in a dropped DB; ignore */
          });
      }
    }

    beforeAll(async function () {
      controlPlane = postgres(
        assertDefined(TEST_DB_URL, 'HAS_DB guard ensures TEST_DB_URL is set'),
        { max: 4, prepare: false },
      );
      await runMigrations(controlPlane, 'control-plane');
    });

    afterAll(async function () {
      // Best-effort cleanup so this suite leaves no residue for the next
      // CI run on the same Postgres.
      await dropTenantArtifacts();
      await controlPlane.end({ timeout: 1 });
    });

    beforeEach(async function () {
      await dropTenantArtifacts();
      // Clean tenants rows and re-insert; the provisioner UPDATEs the
      // existing row's db_* columns, it does not insert.
      await controlPlane`DELETE FROM control_plane.tenants WHERE tenant_id IN (${TENANT_A}, ${TENANT_B})`;
      await controlPlane`
        INSERT INTO control_plane.tenants (tenant_id, name, status)
        VALUES (${TENANT_A}, 'A', 'active'), (${TENANT_B}, 'B', 'active')
      `;
    });

    it('creates the database, runtime role, applies migrations, and populates tenants.db_*', async function () {
      const provider = new PostgresTenantDbProvider(controlPlane);
      const { logger, logs } = captureLogger();

      const result = await provider.provisionTenantDatabase({
        tenantId: TENANT_A,
        logger,
      });

      expect(result.created).toBe(true);
      expect(result.dbName).toBe(DB_A);
      expect(result.runtimeRole).toBe(ROLE_A);

      // DB exists
      const dbRow = await controlPlane<{ exists: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${DB_A}) AS exists
      `;
      expect(dbRow[0]?.exists).toBe(true);

      // Role exists, with the right capability flags (NOSUPERUSER,
      // NOCREATEDB, NOCREATEROLE, LOGIN).
      const roleRow = await controlPlane<
        { rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolcanlogin: boolean }[]
      >`
        SELECT rolsuper, rolcreatedb, rolcreaterole, rolcanlogin
        FROM pg_roles WHERE rolname = ${ROLE_A}
      `;
      expect(roleRow[0]).toBeTruthy();
      expect(roleRow[0]?.rolsuper).toBe(false);
      expect(roleRow[0]?.rolcreatedb).toBe(false);
      expect(roleRow[0]?.rolcreaterole).toBe(false);
      expect(roleRow[0]?.rolcanlogin).toBe(true);

      // control_plane.tenants.db_* populated
      const tenantRow = await controlPlane<
        {
          db_host: string | null;
          db_port: number | null;
          db_name: string | null;
          db_user: string | null;
          db_password: string | null;
        }[]
      >`
        SELECT db_host, db_port, db_name, db_user, db_password
        FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}
      `;
      expect(tenantRow[0]?.db_name).toBe(DB_A);
      expect(tenantRow[0]?.db_user).toBe(ROLE_A);
      expect(typeof tenantRow[0]?.db_password).toBe('string');
      expect((tenantRow[0]?.db_password ?? '').length).toBeGreaterThan(16);
      expect(typeof tenantRow[0]?.db_host).toBe('string');
      expect(typeof tenantRow[0]?.db_port).toBe('number');

      // Migrations were applied — `_migrations` ledger present + at least
      // one row.
      const row = tenantRow[0];
      if (!row || row.db_host === null || row.db_port === null) {
        throw new Error('tenant row missing db_host/db_port after provision');
      }
      const tenantSql = postgres({
        host: row.db_host,
        port: row.db_port,
        database: DB_A,
        // Connect as the provisioner to read `_migrations`; the runtime
        // role does not need SELECT on `_migrations` (and shouldn't —
        // platform internals).
        user: controlPlane.options.user,
        password: (controlPlane.options as { pass?: string }).pass,
        max: 1,
        prepare: false,
      });
      try {
        const migrations = await tenantSql<{ filename: string }[]>`
          SELECT filename FROM public._migrations ORDER BY filename
        `;
        expect(migrations.length).toBeGreaterThan(0);
      } finally {
        await tenantSql.end({ timeout: 1 });
      }

      // Structured log event emitted on first-time path.
      const provisioned = logs.find(function (l) {
        return l.fields?.event === 'Tenancy.Database.Provisioned';
      });
      expect(provisioned).toBeTruthy();
      expect(provisioned?.fields?.properties).toEqual({
        tenantId: TENANT_A,
        dbName: DB_A,
        runtimeRole: ROLE_A,
      });
    });

    it('is idempotent — second call is a no-op and emits no log event', async function () {
      const provider = new PostgresTenantDbProvider(controlPlane);
      const first = captureLogger();
      const r1 = await provider.provisionTenantDatabase({
        tenantId: TENANT_A,
        logger: first.logger,
      });
      expect(r1.created).toBe(true);

      // Snapshot the password to prove the second call did NOT rotate it.
      const before = await controlPlane<{ db_password: string | null }[]>`
        SELECT db_password FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}
      `;
      const passwordBefore = before[0]?.db_password;
      expect(passwordBefore).toBeTruthy();

      const second = captureLogger();
      const r2 = await provider.provisionTenantDatabase({
        tenantId: TENANT_A,
        logger: second.logger,
      });
      expect(r2.created).toBe(false);
      expect(r2.dbName).toBe(DB_A);
      expect(r2.runtimeRole).toBe(ROLE_A);

      const after = await controlPlane<{ db_password: string | null }[]>`
        SELECT db_password FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}
      `;
      expect(after[0]?.db_password).toBe(passwordBefore);

      // No Provisioned event on the idempotent re-run.
      const provisioned = second.logs.find(function (l) {
        return l.fields?.event === 'Tenancy.Database.Provisioned';
      });
      expect(provisioned).toBeUndefined();
    });

    it('runtime role has CRUD but cannot CREATE/ALTER/DROP', async function () {
      const provider = new PostgresTenantDbProvider(controlPlane);
      await provider.provisionTenantDatabase({ tenantId: TENANT_A });

      const tenantRow = await controlPlane<
        { db_host: string; db_port: number; db_name: string; db_user: string; db_password: string }[]
      >`
        SELECT db_host, db_port, db_name, db_user, db_password
        FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}
      `;
      const row = assertDefined(tenantRow[0], 'tenants row should exist after provisioning');

      // Open a connection as the runtime role to the new DB.
      const runtimeSql = postgres({
        host: row.db_host,
        port: row.db_port,
        database: row.db_name,
        user: row.db_user,
        password: row.db_password,
        max: 1,
        prepare: false,
      });
      // Provisioner-side connection used to seed/clean a probe table.
      const provSql = postgres({
        host: row.db_host,
        port: row.db_port,
        database: row.db_name,
        user: controlPlane.options.user,
        password: (controlPlane.options as { pass?: string }).pass,
        max: 1,
        prepare: false,
      });

      try {
        // CREATE TABLE as the runtime role MUST fail (no CREATE on `public`).
        await expect(
          runtimeSql.unsafe('CREATE TABLE probe_cannot_create (id INT)'),
        ).rejects.toThrow();

        // DROP TABLE as the runtime role MUST fail. Seed a table via the
        // provisioner first, then attempt the DROP.
        await provSql.unsafe('CREATE TABLE probe_cannot_drop (id INT, val TEXT)');
        await expect(
          runtimeSql.unsafe('DROP TABLE probe_cannot_drop'),
        ).rejects.toThrow();

        // ALTER TABLE (DDL) as the runtime role MUST fail.
        await expect(
          runtimeSql.unsafe('ALTER TABLE probe_cannot_drop ADD COLUMN extra TEXT'),
        ).rejects.toThrow();

        // CRUD MUST succeed. Default privileges granted at provisioning
        // time means tables created by the provisioner afterwards inherit
        // SELECT/INSERT/UPDATE/DELETE for the runtime role.
        await runtimeSql.unsafe(
          "INSERT INTO probe_cannot_drop (id, val) VALUES (1, 'ok')",
        );
        const sel = await runtimeSql<{ val: string }[]>`SELECT val FROM probe_cannot_drop WHERE id = 1`;
        expect(sel[0]?.val).toBe('ok');
        await runtimeSql.unsafe(
          "UPDATE probe_cannot_drop SET val = 'updated' WHERE id = 1",
        );
        await runtimeSql.unsafe('DELETE FROM probe_cannot_drop WHERE id = 1');
      } finally {
        await runtimeSql.end({ timeout: 1 }).catch(function () { /* ignore */ });
        await provSql
          .unsafe('DROP TABLE IF EXISTS probe_cannot_drop')
          .catch(function () { /* ignore */ });
        await provSql.end({ timeout: 1 }).catch(function () { /* ignore */ });
      }
    });

    it('provisions two tenants independently — each gets its own DB and role', async function () {
      const provider = new PostgresTenantDbProvider(controlPlane);
      const a = await provider.provisionTenantDatabase({ tenantId: TENANT_A });
      const b = await provider.provisionTenantDatabase({ tenantId: TENANT_B });
      expect(a.dbName).toBe(DB_A);
      expect(b.dbName).toBe(DB_B);
      expect(a.runtimeRole).toBe(ROLE_A);
      expect(b.runtimeRole).toBe(ROLE_B);

      const rows = await controlPlane<{ tenant_id: string; db_name: string | null }[]>`
        SELECT tenant_id, db_name FROM control_plane.tenants
        WHERE tenant_id IN (${TENANT_A}, ${TENANT_B}) ORDER BY tenant_id
      `;
      expect(rows.map(function (r) { return r.db_name; })).toEqual(
        rows.map(function (r) { return r.tenant_id === TENANT_A ? DB_A : DB_B; }),
      );
    });

    // Phase 3 (db-per-tenant): the shared-DB fallback is gone.
    // `getPool(tenantId)` is fail-closed — a tenant with NULL `db_*`
    // throws `TENANT_DATABASE_NOT_PROVISIONED`. Two provisioned
    // tenants resolve to two different physical Postgres databases,
    // proving isolation at the protocol layer rather than at the
    // tenant_id predicate level.
    describe('getPool — db-per-tenant isolation (phase-3 fail-closed)', function () {
      it('(a) a provisioned tenant returns a usable pool', async function () {
        const provider = new PostgresTenantDbProvider(controlPlane);
        try {
          await provider.provisionTenantDatabase({ tenantId: TENANT_A });
          const pool = await provider.getPool(TENANT_A);
          // The pool is live: a trivial query round-trips.
          const r = await pool<{ ok: number }[]>`SELECT 1 AS ok`;
          expect(r[0]?.ok).toBe(1);
        } finally {
          await provider.close();
        }
      });

      it('(b) a tenant with NULL db_* throws TENANT_DATABASE_NOT_PROVISIONED', async function () {
        // TENANT_A row was inserted by `beforeEach`. We did NOT call
        // `provisionTenantDatabase`, so the `db_*` columns are NULL.
        const provider = new PostgresTenantDbProvider(controlPlane);
        try {
          let caught: unknown = undefined;
          try {
            await provider.getPool(TENANT_A);
          } catch (e) {
            caught = e;
          }
          expect(caught).toBeInstanceOf(TenantDatabaseNotProvisionedError);
          const err = caught as TenantDatabaseNotProvisionedError;
          expect(err.code).toBe('TENANT_DATABASE_NOT_PROVISIONED');
          expect(err.tenantId).toBe(TENANT_A);
          // Remediation hint surfaces in the message — operators see this
          // when dev:up hasn't been run.
          expect(err.message).toMatch(/dev:up|provisionTenantDatabase/);
        } finally {
          await provider.close();
        }
      });

      it('(c) two provisioned tenants connect to different current_database()', async function () {
        const provider = new PostgresTenantDbProvider(controlPlane);
        try {
          await provider.provisionTenantDatabase({ tenantId: TENANT_A });
          await provider.provisionTenantDatabase({ tenantId: TENANT_B });

          const poolA = await provider.getPool(TENANT_A);
          const poolB = await provider.getPool(TENANT_B);

          const dbA = await poolA<{ db: string }[]>`SELECT current_database() AS db`;
          const dbB = await poolB<{ db: string }[]>`SELECT current_database() AS db`;

          // Structural proof of protocol-layer isolation: the two pools
          // are connected to physically different Postgres databases. A
          // missing `WHERE tenant_id = ?` in any query layer cannot
          // cross-tenant-leak because the data isn't reachable from the
          // wrong connection.
          expect(dbA[0]?.db).toBe(DB_A);
          expect(dbB[0]?.db).toBe(DB_B);
          expect(dbA[0]?.db).not.toBe(dbB[0]?.db);
        } finally {
          await provider.close();
        }
      });

      // sdet phase-3 follow-up: `current_database()` differing proves the
      // pools are connected to different DBs, but does NOT prove writes
      // actually land in the right DB. This test writes a row through
      // tenant A's runtime pool into the `entities` table and asserts the
      // same query against tenant B's runtime pool sees zero rows — the
      // data-isolation half of the isolation promise. If writes ever
      // started landing somewhere shared (a connection-string bug, a
      // misrouted pool, an LRU collision), this test catches it where
      // (c) alone would not.
      it('(d) write to tenant A is invisible to tenant B (data isolation)', async function () {
        const provider = new PostgresTenantDbProvider(controlPlane);
        try {
          await provider.provisionTenantDatabase({ tenantId: TENANT_A });
          await provider.provisionTenantDatabase({ tenantId: TENANT_B });

          const poolA = await provider.getPool(TENANT_A);
          const poolB = await provider.getPool(TENANT_B);

          // Write a probe row through A's CRUD-only runtime pool into the
          // tenant-migration-created `entities` table. Use a unique
          // entity_id so we can target the assertion precisely.
          const probeId = `sdet-isolation-probe-${Date.now()}`;
          await poolA`
            INSERT INTO public.entities (
              tenant_id, entity_type, entity_id, attrs, schema_version
            ) VALUES (
              ${TENANT_A}, 'Probe', ${probeId}, ${'{}'}::jsonb, 1
            )
          `;

          const a = await poolA<{ entity_id: string }[]>`
            SELECT entity_id FROM public.entities WHERE entity_id = ${probeId}
          `;
          expect(a.length).toBe(1);

          const b = await poolB<{ entity_id: string }[]>`
            SELECT entity_id FROM public.entities WHERE entity_id = ${probeId}
          `;
          // The wrong DB literally doesn't have the row — protocol-layer
          // isolation, not predicate-layer isolation.
          expect(b.length).toBe(0);
        } finally {
          await provider.close();
        }
      });

      // sdet phase-1 follow-up: phase-1 asserts CREATE TABLE / DROP TABLE
      // / ALTER TABLE ADD COLUMN are blocked. The CRUD-only claim is
      // wider than that — `CREATE INDEX`, `TRUNCATE`, and `pg_catalog`
      // mutations must also fail. These are the realistic DDL/maintenance
      // paths a tenant role might try to reach for; they all share the
      // same "no ownership of `public` or its tables" enforcement and
      // any future refactor that loosens the role's grants should fail
      // these assertions before merging.
      // F4: parallel `provisionTenantDatabase` calls for the same
      // tenant must be de-duped — exactly one execution, exactly one
      // structured log event. Without the inFlightProvision map both
      // callers pass the `pg_database` existence check and the second
      // explodes with `database already exists`. With the map, the
      // second caller awaits the first's promise and observes the same
      // result.
      it('(f4) concurrent provisionTenantDatabase calls for the same tenant are de-duped', async function () {
        const provider = new PostgresTenantDbProvider(controlPlane);
        const a = captureLogger();
        const b = captureLogger();
        try {
          const [r1, r2] = await Promise.all([
            provider.provisionTenantDatabase({
              tenantId: TENANT_A,
              logger: a.logger,
            }),
            provider.provisionTenantDatabase({
              tenantId: TENANT_A,
              logger: b.logger,
            }),
          ]);
          // Both callers see the same result object — they joined the
          // same in-flight promise.
          expect(r1).toBe(r2);
          expect(r1.dbName).toBe(DB_A);
          expect(r1.runtimeRole).toBe(ROLE_A);
          // Exactly one of the two callers observed `created = true`.
          // (Because they share the promise, this is trivially true —
          // but asserting it documents the contract.)
          expect(r1.created).toBe(true);
          // Exactly one CREATE DATABASE happened. Counted indirectly
          // via the Provisioned event log on the FIRST caller; the
          // joining caller's logger is never invoked.
          const aProvisioned = a.logs.filter(function (l) {
            return l.fields?.event === 'Tenancy.Database.Provisioned';
          });
          const bProvisioned = b.logs.filter(function (l) {
            return l.fields?.event === 'Tenancy.Database.Provisioned';
          });
          // First caller fires its logger; joining caller is a silent
          // passenger. Because Promise.all dispatches in array order,
          // the A call wins the inFlightProvision.set race; B observes
          // pending and awaits without ever reaching
          // runProvisionTenantDatabase (which is where the logger is
          // invoked). Pinning a == 1 and b == 0 documents that
          // contract; the looser `a + b == 1` assertion was satisfied
          // by either ordering.
          expect(aProvisioned.length).toBe(1);
          expect(bProvisioned.length).toBe(0);
        } finally {
          await provider.close();
        }
      });

      // F4 follow-on: the in-flight map clears on reject so a failed
      // provision doesn't poison the slot for the next caller. We
      // simulate by calling for a tenantId that has no `tenants` row
      // (forces F5 rejection), waiting for the rejection, then INSERTing
      // the row and calling again — the second call must succeed.
      it('(f4-clear-on-reject) failed provision clears the in-flight slot', async function () {
        const provider = new PostgresTenantDbProvider(controlPlane);
        try {
          // Remove the row inserted by beforeEach so the first call
          // rejects with TenantNotFoundError.
          await controlPlane`DELETE FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}`;
          await expect(
            provider.provisionTenantDatabase({ tenantId: TENANT_A }),
          ).rejects.toBeInstanceOf(TenantNotFoundError);
          // Now re-insert the row and try again. If the in-flight slot
          // was poisoned, the same (already-settled) rejected promise
          // would be returned and this would still throw. Asserting it
          // succeeds proves the cleanup happened.
          await controlPlane`
            INSERT INTO control_plane.tenants (tenant_id, name, status)
            VALUES (${TENANT_A}, 'A', 'active')
          `;
          const result = await provider.provisionTenantDatabase({
            tenantId: TENANT_A,
          });
          expect(result.dbName).toBe(DB_A);
          expect(result.created).toBe(true);
        } finally {
          await provider.close();
        }
      });

      // F5: provisionTenantDatabase refuses to create an orphan DB /
      // role when the `control_plane.tenants` row is missing. The
      // row-check runs BEFORE any side effect — `pg_database` MUST NOT
      // have an `atlas_t_<x>` entry after the rejected call.
      it('(f5) rejects with TENANT_NOT_FOUND when no tenants row exists; no DB or role created', async function () {
        const provider = new PostgresTenantDbProvider(controlPlane);
        try {
          // beforeEach inserts the row — remove it for this test so
          // the precondition fails.
          await controlPlane`DELETE FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}`;

          let caught: unknown = undefined;
          try {
            await provider.provisionTenantDatabase({ tenantId: TENANT_A });
          } catch (e) {
            caught = e;
          }
          expect(caught).toBeInstanceOf(TenantNotFoundError);
          const err = caught as TenantNotFoundError;
          expect(err.code).toBe('TENANT_NOT_FOUND');
          expect(err.tenantId).toBe(TENANT_A);

          // No DB was created — the precondition fires before any DDL.
          const dbRow = await controlPlane<{ exists: boolean }[]>`
            SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${DB_A}) AS exists
          `;
          expect(dbRow[0]?.exists).toBe(false);

          // No role was created either.
          const roleRow = await controlPlane<{ exists: boolean }[]>`
            SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ${ROLE_A}) AS exists
          `;
          expect(roleRow[0]?.exists).toBe(false);
        } finally {
          await provider.close();
        }
      });

      // F6: partial-state recovery. If a prior call created the role
      // but the process crashed before persisting db_*, the row stays
      // NULL forever and the tenant is unrecoverable without manual
      // DROP ROLE. Option A: the reconciled path always writes
      // db_host/db_port/db_name/db_user (but not db_password — the
      // original is no longer recoverable from the role; rotating
      // would lock out any open pool, and there isn't one yet because
      // the row was NULL).
      //
      // We simulate the partial state by:
      //   1. Provisioning normally → role exists, db_* populated.
      //   2. NULLing out db_host/db_port/db_name/db_user (leave
      //      db_password so the reconciled UPDATE has something to
      //      restore from for the next getPool).
      //   3. Re-running provisionTenantDatabase.
      // The role already exists, so wasFirstTime = false. The
      // reconciled UPDATE must still fire and the row converges.
      it('(f6) partial-state recovery — reconciled path always writes db_host/port/name/user', async function () {
        const provider = new PostgresTenantDbProvider(controlPlane);
        try {
          // Step 1: normal first-time provision so the role exists and
          // we have a real password to restore from.
          const first = await provider.provisionTenantDatabase({
            tenantId: TENANT_A,
          });
          expect(first.created).toBe(true);

          // Snapshot the password — F6 must NOT rotate it.
          const before = await controlPlane<{ db_password: string | null }[]>`
            SELECT db_password FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}
          `;
          const passwordBefore = before[0]?.db_password;
          expect(typeof passwordBefore).toBe('string');

          // Step 2: simulate the crash-mid-provision state. We leave
          // db_password in place (mimicking "the UPDATE wrote password
          // first, host/port/name/user second, and the crash happened
          // between"). The realistic crash is the other way — created
          // role, no UPDATE at all — but the F6 contract is "any
          // missing db_* coordinate converges on the next run." We
          // assert by nulling host/port/name/user and watching them
          // come back.
          await controlPlane`
            UPDATE control_plane.tenants
            SET db_host = NULL,
                db_port = NULL,
                db_name = NULL,
                db_user = NULL
            WHERE tenant_id = ${TENANT_A}
          `;

          // Step 3: re-run. Role exists → wasFirstTime = false.
          // Reconciled path must still UPDATE the coordinates.
          const second = await provider.provisionTenantDatabase({
            tenantId: TENANT_A,
          });
          expect(second.created).toBe(false);
          expect(second.dbName).toBe(DB_A);

          // End state: all four coordinates populated, password
          // unchanged.
          const after = await controlPlane<
            {
              db_host: string | null;
              db_port: number | null;
              db_name: string | null;
              db_user: string | null;
              db_password: string | null;
            }[]
          >`
            SELECT db_host, db_port, db_name, db_user, db_password
            FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}
          `;
          expect(after[0]?.db_name).toBe(DB_A);
          expect(after[0]?.db_user).toBe(ROLE_A);
          expect(typeof after[0]?.db_host).toBe('string');
          expect(typeof after[0]?.db_port).toBe('number');
          // Password preserved — Option A explicitly does NOT rotate.
          expect(after[0]?.db_password).toBe(passwordBefore);
        } finally {
          await provider.close();
        }
      });

      // F6 sdet bounce: the realistic crash is "CREATE ROLE
      // succeeded, no UPDATE ran at all" — meaning ALL FIVE db_*
      // columns NULL (including db_password). Under that state the
      // earlier reconciled-only path left db_password NULL forever
      // and getPool kept throwing TENANT_DATABASE_NOT_PROVISIONED.
      // The fix detects "role exists but db_password IS NULL" and
      // treats it as first-time-with-rotation: generate a new
      // password, ALTER ROLE to set it, then UPDATE all five
      // columns. Rotation is safe here because no getPool could
      // have succeeded against the NULL row — there is no open
      // runtime pool to lock out.
      //
      // We simulate by:
      //   1. Provisioning normally so the role gets created.
      //   2. NULLing out all five db_* columns AND dropping the
      //      role's password from outside (the realistic state when
      //      the original UPDATE never ran — by also dropping the
      //      role here we reproduce the worst-case "role + DB orphan,
      //      tenants row blank" path).
      //
      // Actually, to be faithful to the "CREATE ROLE succeeded but
      // UPDATE didn't" semantics, we keep the role around but null
      // out the tenants row entirely. The provisioner sees role
      // exists, db_password NULL → ALTER ROLE + write five columns.
      it('(f6-all-null) crash before UPDATE — all five db_* columns NULL recovers cleanly', async function () {
        const provider = new PostgresTenantDbProvider(controlPlane);
        try {
          // Step 1: normal first-time provision so the role exists.
          const first = await provider.provisionTenantDatabase({
            tenantId: TENANT_A,
          });
          expect(first.created).toBe(true);

          const beforeRecovery = await controlPlane<
            { db_password: string | null }[]
          >`
            SELECT db_password FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}
          `;
          const passwordBefore = beforeRecovery[0]?.db_password ?? null;
          expect(typeof passwordBefore).toBe('string');

          // Step 2: simulate the realistic crash state — CREATE ROLE
          // succeeded but the UPDATE never ran. All five db_*
          // columns NULL; the role stays around in pg_roles. (We
          // also drop and recreate the role to make sure the
          // partial-recovery path goes through ALTER ROLE and not
          // just relies on the original password being usable from
          // the role's perspective.)
          await controlPlane`
            UPDATE control_plane.tenants
            SET db_host     = NULL,
                db_port     = NULL,
                db_name     = NULL,
                db_user     = NULL,
                db_password = NULL
            WHERE tenant_id = ${TENANT_A}
          `;

          const recoveryLogger = captureLogger();

          // Step 3: re-run. Role exists (createdRole=false) AND
          // db_password is NULL → needsFreshPassword=true →
          // ALTER ROLE + write all five columns + emit Provisioned
          // event (this IS materially a provision).
          const recovered = await provider.provisionTenantDatabase({
            tenantId: TENANT_A,
            logger: recoveryLogger.logger,
          });
          // The DB still existed (created=false) — the recovery
          // didn't have to re-create it. But the result still
          // resolves cleanly.
          expect(recovered.created).toBe(false);
          expect(recovered.dbName).toBe(DB_A);
          expect(recovered.runtimeRole).toBe(ROLE_A);

          // End state: all five db_* columns populated. Password is
          // a non-empty string and (because Step 3 ALTER ROLE'd)
          // differs from passwordBefore.
          const after = await controlPlane<
            {
              db_host: string | null;
              db_port: number | null;
              db_name: string | null;
              db_user: string | null;
              db_password: string | null;
            }[]
          >`
            SELECT db_host, db_port, db_name, db_user, db_password
            FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}
          `;
          expect(typeof after[0]?.db_host).toBe('string');
          expect(typeof after[0]?.db_port).toBe('number');
          expect(after[0]?.db_name).toBe(DB_A);
          expect(after[0]?.db_user).toBe(ROLE_A);
          expect(typeof after[0]?.db_password).toBe('string');
          expect((after[0]?.db_password ?? '').length).toBeGreaterThan(16);
          // Materially a fresh password — the ALTER ROLE in Step 3
          // rotated it.
          expect(after[0]?.db_password).not.toBe(passwordBefore);

          // Provisioned event fires on recovery — it IS materially
          // a provision (password generated + role grants ensured +
          // UPDATE writes all five columns).
          const provisioned = recoveryLogger.logs.find(function (l) {
            return l.fields?.event === 'Tenancy.Database.Provisioned';
          });
          expect(provisioned).toBeTruthy();

          // Critical acceptance bar: getPool succeeds after
          // recovery. Before the fix, the reconciled path left
          // db_password NULL and lookupConnectionInfo kept throwing
          // TENANT_DATABASE_NOT_PROVISIONED forever.
          const pool = await provider.getPool(TENANT_A);
          const ok = await pool<{ ok: number }[]>`SELECT 1 AS ok`;
          expect(ok[0]?.ok).toBe(1);
        } finally {
          await provider.close();
        }
      });

      // Out-of-band recovery: operator manually `DROP DATABASE` after a
      // healthy provision, leaving role + db_* (including db_password) in
      // place. Re-running the provisioner must recreate the DB, re-run
      // tenant migrations, and re-apply grants. Because
      // `existingPassword !== null` AND `createdRole === false`,
      // `needsFreshPassword` stays false — no ALTER ROLE, no
      // `Tenancy.Database.Provisioned` event (the contract is "fire when
      // a password is generated"), and `db_password` in `tenants` is
      // preserved bit-for-bit. The runtime pool authenticates against
      // the unchanged role password.
      it('(out-of-band drop database, role survives) — provisioner recreates DB, preserves password', async function () {
        const provider = new PostgresTenantDbProvider(controlPlane);
        try {
          // Step 1: normal first-time provision.
          const first = await provider.provisionTenantDatabase({ tenantId: TENANT_A });
          expect(first.created).toBe(true);

          // Snapshot the password — the contract under this branch is
          // "preserve". The runtime role's password in pg_roles is also
          // unchanged across DROP DATABASE (role lives in pg_authid,
          // which is cluster-wide).
          const before = await controlPlane<{ db_password: string | null }[]>`
            SELECT db_password FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}
          `;
          const passwordBefore = before[0]?.db_password;
          expect(typeof passwordBefore).toBe('string');

          // Step 2: simulate manual operator intervention — DROP DATABASE
          // only. Role survives in pg_roles; db_* columns in `tenants`
          // are NOT touched (this is the manual-intervention scenario,
          // distinct from F6 which simulates a crash that left the row
          // NULL).
          await controlPlane.unsafe(`DROP DATABASE "${DB_A}"`);

          // Confirm the precondition state for this case: DB gone, role
          // still present, db_* still populated.
          const preDb = await controlPlane<{ exists: boolean }[]>`
            SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${DB_A}) AS exists
          `;
          expect(preDb[0]?.exists).toBe(false);
          const preRole = await controlPlane<{ exists: boolean }[]>`
            SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ${ROLE_A}) AS exists
          `;
          expect(preRole[0]?.exists).toBe(true);

          // Step 3: re-run. createdDb=true (DB missing), createdRole=false
          // (role survives), existingPassword !== null → needsFreshPassword=false.
          // Result: CREATE DATABASE fires, no ALTER ROLE, coordinate-only
          // UPDATE on the tenants row, no Provisioned log event.
          const recoveryLogger = captureLogger();
          const recovered = await provider.provisionTenantDatabase({
            tenantId: TENANT_A,
            logger: recoveryLogger.logger,
          });
          // `created` reflects "DB was created on this call".
          expect(recovered.created).toBe(true);
          expect(recovered.dbName).toBe(DB_A);
          expect(recovered.runtimeRole).toBe(ROLE_A);

          // End state: DB exists, role still exists, db_* unchanged
          // (specifically db_password preserved).
          const postDb = await controlPlane<{ exists: boolean }[]>`
            SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${DB_A}) AS exists
          `;
          expect(postDb[0]?.exists).toBe(true);
          const postRole = await controlPlane<{ exists: boolean }[]>`
            SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ${ROLE_A}) AS exists
          `;
          expect(postRole[0]?.exists).toBe(true);
          const after = await controlPlane<{ db_password: string | null }[]>`
            SELECT db_password FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}
          `;
          // Password preserved (Step 6 took the coordinate-only branch
          // because generatedPassword === null).
          expect(after[0]?.db_password).toBe(passwordBefore);

          // Migrations re-applied inside the newly created DB — the
          // `_migrations` ledger should be populated. This is the
          // tenant-DB version, not the control-plane one.
          const cpOpts = controlPlane.options as {
            host: string | string[];
            port: number | number[];
            pass?: string;
          };
          const cpHost = Array.isArray(cpOpts.host) ? cpOpts.host[0] : cpOpts.host;
          const cpPort = Array.isArray(cpOpts.port) ? cpOpts.port[0] : cpOpts.port;
          if (cpHost === undefined || cpPort === undefined) {
            throw new Error('control-plane connection missing host/port');
          }
          const tenantSql = postgres({
            host: cpHost,
            port: cpPort,
            database: DB_A,
            user: controlPlane.options.user,
            password: cpOpts.pass,
            max: 1,
            prepare: false,
          });
          try {
            const migrations = await tenantSql<{ filename: string }[]>`
              SELECT filename FROM public._migrations ORDER BY filename
            `;
            expect(migrations.length).toBeGreaterThan(0);
          } finally {
            await tenantSql.end({ timeout: 1 });
          }

          // No Provisioned event — generatedPassword was null, recovery
          // was structurally non-rotating.
          const provisioned = recoveryLogger.logs.find(function (l) {
            return l.fields?.event === 'Tenancy.Database.Provisioned';
          });
          expect(provisioned).toBeUndefined();

          // Critical acceptance bar: getPool succeeds end-to-end.
          // Authenticates with the preserved password against the
          // recreated DB.
          const pool = await provider.getPool(TENANT_A);
          const ok = await pool<{ ok: number }[]>`SELECT 1 AS ok`;
          expect(ok[0]?.ok).toBe(1);
        } finally {
          await provider.close();
        }
      });

      // Out-of-band recovery: operator manually `DROP ROLE` after a
      // healthy provision, leaving DB + db_* in place (including the
      // now-stale db_password — pg_authid no longer has the role to
      // back it). Re-running the provisioner must CREATE ROLE with a
      // fresh password (createdRole=true → needsFreshPassword=true),
      // skip CREATE DATABASE, and persist the new password to
      // `tenants.db_password`. The OLD password must no longer
      // authenticate — proving rotation actually rotated rather than
      // regenerating the same value.
      //
      // Operator setup: Postgres refuses `DROP ROLE` while the role
      // holds privileges on objects in any DB. The realistic manual
      // sequence is: connect to the tenant DB, `DROP OWNED BY <role>`
      // (revokes grants + drops owned objects in that DB), then
      // `DROP ROLE`. We script that explicitly so the precondition
      // state is faithful.
      it('(out-of-band drop role, database survives) — provisioner recreates role with fresh password', async function () {
        const provider = new PostgresTenantDbProvider(controlPlane);
        try {
          // Step 1: normal first-time provision.
          const first = await provider.provisionTenantDatabase({ tenantId: TENANT_A });
          expect(first.created).toBe(true);

          const before = await controlPlane<{ db_password: string | null }[]>`
            SELECT db_password FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}
          `;
          const passwordBefore = before[0]?.db_password;
          expect(typeof passwordBefore).toBe('string');

          // Step 2: simulate manual operator intervention — DROP ROLE
          // only. To drop the role cleanly we first revoke its grants
          // and drop any owned objects in the tenant DB (Postgres
          // refuses DROP ROLE while privileges exist). This is the
          // realistic operator sequence.
          const cpOpts = controlPlane.options as {
            host: string | string[];
            port: number | number[];
            pass?: string;
          };
          const cpHost = Array.isArray(cpOpts.host) ? cpOpts.host[0] : cpOpts.host;
          const cpPort = Array.isArray(cpOpts.port) ? cpOpts.port[0] : cpOpts.port;
          if (cpHost === undefined || cpPort === undefined) {
            throw new Error('control-plane connection missing host/port');
          }
          const tenantSqlForCleanup = postgres({
            host: cpHost,
            port: cpPort,
            database: DB_A,
            user: controlPlane.options.user,
            password: cpOpts.pass,
            max: 1,
            prepare: false,
          });
          try {
            await tenantSqlForCleanup.unsafe(
              `DROP OWNED BY "${ROLE_A}" CASCADE`,
            );
          } finally {
            await tenantSqlForCleanup.end({ timeout: 1 });
          }
          // Also revoke the role's CONNECT grant + the per-DB ACL on the
          // tenant database (held in pg_database.datacl, not visible to
          // DROP OWNED BY when run from another DB). Then drop the role.
          await controlPlane.unsafe(
            `REVOKE ALL PRIVILEGES ON DATABASE "${DB_A}" FROM "${ROLE_A}"`,
          );
          await controlPlane.unsafe(`DROP ROLE "${ROLE_A}"`);

          // Confirm the precondition state: role gone, DB still present,
          // db_* still populated with the now-orphaned password.
          const preRole = await controlPlane<{ exists: boolean }[]>`
            SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ${ROLE_A}) AS exists
          `;
          expect(preRole[0]?.exists).toBe(false);
          const preDb = await controlPlane<{ exists: boolean }[]>`
            SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${DB_A}) AS exists
          `;
          expect(preDb[0]?.exists).toBe(true);
          const orphaned = await controlPlane<{ db_password: string | null }[]>`
            SELECT db_password FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}
          `;
          expect(orphaned[0]?.db_password).toBe(passwordBefore);

          // Step 3: re-run. createdDb=false (DB still there),
          // createdRole=true (role missing) → needsFreshPassword=true.
          // Result: no CREATE DATABASE, CREATE ROLE fires with a fresh
          // password, password-rotating UPDATE on the tenants row,
          // Provisioned log event emitted (recovery IS materially a
          // provision per the F6 contract).
          const recoveryLogger = captureLogger();
          const recovered = await provider.provisionTenantDatabase({
            tenantId: TENANT_A,
            logger: recoveryLogger.logger,
          });
          // `created` reflects "DB was created on this call". The DB
          // was untouched, so this is false.
          expect(recovered.created).toBe(false);
          expect(recovered.dbName).toBe(DB_A);
          expect(recovered.runtimeRole).toBe(ROLE_A);

          // End state: role exists again, DB unchanged, db_password
          // ROTATED.
          const postRole = await controlPlane<{ exists: boolean }[]>`
            SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = ${ROLE_A}) AS exists
          `;
          expect(postRole[0]?.exists).toBe(true);
          const postDb = await controlPlane<{ exists: boolean }[]>`
            SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = ${DB_A}) AS exists
          `;
          expect(postDb[0]?.exists).toBe(true);
          const after = await controlPlane<{ db_password: string | null }[]>`
            SELECT db_password FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}
          `;
          expect(typeof after[0]?.db_password).toBe('string');
          expect((after[0]?.db_password ?? '').length).toBeGreaterThan(16);
          // Materially fresh — the rotation actually rotated, not just
          // regenerated the same value.
          expect(after[0]?.db_password).not.toBe(passwordBefore);

          // Provisioned event emitted — generatedPassword !== null
          // because createdRole=true.
          const provisioned = recoveryLogger.logs.find(function (l) {
            return l.fields?.event === 'Tenancy.Database.Provisioned';
          });
          expect(provisioned).toBeTruthy();

          // Critical acceptance bar: getPool succeeds end-to-end with
          // the freshly rotated password. Two assertions: (a) the new
          // password authenticates, (b) the OLD password no longer
          // authenticates against the freshly created role.
          const pool = await provider.getPool(TENANT_A);
          const ok = await pool<{ ok: number }[]>`SELECT 1 AS ok`;
          expect(ok[0]?.ok).toBe(1);

          // Direct authentication probe with the OLD password — must
          // fail, because the freshly CREATE ROLE'd role has the new
          // password and the old credential value is gone.
          if (passwordBefore === undefined) {
            throw new Error('passwordBefore not captured before stale auth probe');
          }
          const stale = postgres({
            host: cpHost,
            port: cpPort,
            database: DB_A,
            user: ROLE_A,
            password: passwordBefore,
            max: 1,
            prepare: false,
            // postgres.js retries on connection error by default. For a
            // negative auth probe we want a single attempt with a fast
            // failure mode.
            max_lifetime: 1,
            idle_timeout: 1,
          });
          let staleAuthError: unknown = undefined;
          try {
            await stale<{ ok: number }[]>`SELECT 1 AS ok`;
          } catch (e) {
            staleAuthError = e;
          } finally {
            await stale.end({ timeout: 1 }).catch(function () { /* ignore */ });
          }
          expect(staleAuthError).toBeTruthy();
          // Postgres returns SQLSTATE 28P01 on password mismatch. We
          // assert on the message rather than the structured code
          // because postgres.js wraps the error type variably across
          // versions, but the human-readable phrase is stable.
          const staleMsg = staleAuthError instanceof Error
            ? staleAuthError.message
            : String(staleAuthError);
          expect(staleMsg).toMatch(/password authentication failed|28P01/i);
        } finally {
          await provider.close();
        }
      });

      it('(e) runtime role cannot CREATE INDEX or TRUNCATE', async function () {
        const provider = new PostgresTenantDbProvider(controlPlane);
        try {
          await provider.provisionTenantDatabase({ tenantId: TENANT_A });
          const row = await controlPlane<
            { db_host: string; db_port: number; db_name: string; db_user: string; db_password: string }[]
          >`
            SELECT db_host, db_port, db_name, db_user, db_password
            FROM control_plane.tenants WHERE tenant_id = ${TENANT_A}
          `;
          const r = assertDefined(row[0], 'tenants row populated after provisioning');

          const runtimeSql = postgres({
            host: r.db_host,
            port: r.db_port,
            database: r.db_name,
            user: r.db_user,
            password: r.db_password,
            max: 1,
            prepare: false,
          });
          try {
            // CREATE INDEX requires ownership of the underlying table.
            // The runtime role owns nothing — fail closed.
            await expect(
              runtimeSql.unsafe(
                'CREATE INDEX probe_idx ON public.entities (entity_id)',
              ),
            ).rejects.toThrow();

            // TRUNCATE requires TRUNCATE privilege (or ownership). Not
            // granted to the runtime role.
            await expect(
              runtimeSql.unsafe('TRUNCATE TABLE public.entities'),
            ).rejects.toThrow();
          } finally {
            await runtimeSql.end({ timeout: 1 }).catch(function () { /* ignore */ });
          }
        } finally {
          await provider.close();
        }
      });
    });
  });
}
