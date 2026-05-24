#!/usr/bin/env node
/**
 * cli-capture — capture the live Atlas topology (control-plane + provisioned
 * tenant DBs) into a golden snapshot directory. READ-ONLY.
 *
 * Usage:
 *   node --experimental-transform-types tools/db-snapshot/src/cli-capture.ts [goldenDir]
 *
 * Env:
 *   CONTROL_PLANE_DB_URL — superuser control-plane URL (loopback-guarded).
 *
 * WARNING: the golden bundle carries db_password values verbatim. The output
 * dir is gitignored. Do not commit it; do not run against a non-loopback host.
 */
import { captureTopology } from './capture.ts';
import { assertLoopback, parseSuperuser } from './loopback.ts';
import { writeBundle } from './serialize.ts';

const DEFAULT_DB_URL =
    'postgres://atlas_platform:local_dev_password@localhost:15433/control_plane';
const DEFAULT_GOLDEN_DIR = 'fixtures/golden';

async function main(): Promise<void> {
    const goldenDir = process.argv[2] ?? DEFAULT_GOLDEN_DIR;
    const dbUrl = process.env['CONTROL_PLANE_DB_URL'] ?? DEFAULT_DB_URL;

    const guard = assertLoopback(dbUrl);
    if (!guard.ok) {
        process.stderr.write(`\n✗ db-snapshot capture failed: ${guard.reason}\n\n`);
        process.exit(1);
    }

    const superuser = parseSuperuser(dbUrl);
    process.stdout.write(`▸ db-snapshot capture (READ-ONLY)\n  source: ${dbUrl}\n`);
    const bundle = await captureTopology(superuser);
    const manifest = await writeBundle(bundle, goldenDir);

    process.stdout.write(`  ✔ captured ${bundle.databases.length} databases\n`);
    for (const d of manifest.databases) {
        const totalRows = d.tables.reduce((n, t) => n + t.rowCount, 0);
        process.stdout.write(`    · ${d.database} (${d.kind}) — ${totalRows} rows, sha256 ${d.sha256.slice(0, 12)}…\n`);
    }
    process.stdout.write(`  ✔ written to ${goldenDir} (gitignored — carries db_password)\n`);
}

main().catch((e: unknown) => {
    process.stderr.write(`\n✗ db-snapshot capture failed: ${(e as Error).stack ?? String(e)}\n\n`);
    process.exit(1);
});
