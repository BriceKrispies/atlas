#!/usr/bin/env node
/**
 * cli-verify — re-capture the live topology, diff against the golden bundle,
 * print a structured report, and exit non-zero on any diff.
 *
 * Usage:
 *   node --experimental-transform-types tools/db-snapshot/src/cli-verify.ts [goldenDir]
 *
 * Env:
 *   CONTROL_PLANE_DB_URL — superuser control-plane URL (loopback-guarded).
 */
import { assertLoopback, parseSuperuser } from './loopback.ts';
import { verifyAgainstGolden } from './verify.ts';

const DEFAULT_DB_URL =
    'postgres://atlas_platform:local_dev_password@localhost:15433/control_plane';
const DEFAULT_GOLDEN_DIR = 'fixtures/golden';

async function main(): Promise<void> {
    const goldenDir = process.argv[2] ?? DEFAULT_GOLDEN_DIR;
    const dbUrl = process.env['CONTROL_PLANE_DB_URL'] ?? DEFAULT_DB_URL;

    const guard = assertLoopback(dbUrl);
    if (!guard.ok) {
        process.stderr.write(`\n✗ db-snapshot verify failed: ${guard.reason}\n\n`);
        process.exit(1);
    }

    const superuser = parseSuperuser(dbUrl);
    process.stdout.write(`▸ db-snapshot verify\n  golden: ${goldenDir}\n  source: ${dbUrl}\n`);
    const report = await verifyAgainstGolden(goldenDir, superuser);

    if (report.diffCount === 0) {
        process.stdout.write(`  ✔ no diffs — live topology matches golden\n`);
        return;
    }
    process.stderr.write(`  ✗ ${report.diffCount} diff(s):\n`);
    for (const d of report.diffs.slice(0, 50)) {
        process.stderr.write(`    [${d.kind}] ${d.database} ${d.table}: ${d.detail}\n`);
    }
    if (report.diffs.length > 50) {
        process.stderr.write(`    … and ${report.diffs.length - 50} more\n`);
    }
    process.exit(1);
}

main().catch((e: unknown) => {
    process.stderr.write(`\n✗ db-snapshot verify failed: ${(e as Error).stack ?? String(e)}\n\n`);
    process.exit(1);
});
