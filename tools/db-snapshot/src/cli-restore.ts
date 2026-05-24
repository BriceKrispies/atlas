#!/usr/bin/env node
/**
 * cli-restore — restore a golden snapshot bundle into target databases.
 *
 * Usage:
 *   node --experimental-transform-types tools/db-snapshot/src/cli-restore.ts \
 *       [goldenDir] [--control-plane-db <name>]
 *
 * Env:
 *   CONTROL_PLANE_DB_URL — superuser URL (loopback-guarded). Its db name is the
 *                          DEFAULT control-plane restore target; override with
 *                          --control-plane-db to restore into a scratch DB.
 *
 * WARNING: restore WRITES (creates databases/roles, inserts rows). It refuses
 * non-loopback hosts. By default it targets the control-plane DB named in the
 * URL — pass --control-plane-db <scratch> to avoid clobbering a live DB.
 */
import { assertLoopback, parseSuperuser } from './loopback.ts';
import { restoreBundle } from './restore.ts';
import { readBundle } from './serialize.ts';

const DEFAULT_DB_URL =
    'postgres://atlas_platform:local_dev_password@localhost:15433/control_plane';
const DEFAULT_GOLDEN_DIR = 'fixtures/golden';

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const goldenDir = args.find((a) => !a.startsWith('--')) ?? DEFAULT_GOLDEN_DIR;
    const cpFlagIdx = args.indexOf('--control-plane-db');
    const dbUrl = process.env['CONTROL_PLANE_DB_URL'] ?? DEFAULT_DB_URL;

    const guard = assertLoopback(dbUrl);
    if (!guard.ok) {
        process.stderr.write(`\n✗ db-snapshot restore failed: ${guard.reason}\n\n`);
        process.exit(1);
    }

    const superuser = parseSuperuser(dbUrl);
    const controlPlaneDatabase =
        cpFlagIdx >= 0 ? (args[cpFlagIdx + 1] ?? superuser.database) : superuser.database;

    const bundle = await readBundle(goldenDir);
    process.stdout.write(
        `▸ db-snapshot restore\n  golden: ${goldenDir}\n  target control-plane DB: ${controlPlaneDatabase}\n`,
    );
    await restoreBundle(bundle, {
        superuser: {
            host: superuser.host,
            port: superuser.port,
            user: superuser.user,
            password: superuser.password,
        },
        controlPlaneDatabase,
    });
    process.stdout.write(`  ✔ restored ${bundle.databases.length} databases\n`);
}

main().catch((e: unknown) => {
    process.stderr.write(`\n✗ db-snapshot restore failed: ${(e as Error).stack ?? String(e)}\n\n`);
    process.exit(1);
});
