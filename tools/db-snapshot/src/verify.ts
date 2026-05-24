/**
 * verify — load the golden bundle, re-capture the live topology, diff, and
 * produce a structured report. Non-zero exit on any diff is the CLI's job
 * (`cli-verify.ts`); this module is pure orchestration returning the report.
 */
import type { Diff, SnapshotBundle } from './types.ts';
import { captureTopology } from './capture.ts';
import { diffBundle } from './diff.ts';
import { readBundle } from './serialize.ts';

export interface VerifyReport {
    goldenCapturedAt: string;
    actualCapturedAt: string;
    diffCount: number;
    diffs: Diff[];
}

/**
 * Verify the live topology against the golden bundle on disk.
 * `superuser` is the privileged connection used to re-capture.
 */
export async function verifyAgainstGolden(
    goldenDir: string,
    superuser: {
        host: string;
        port: number;
        user: string;
        password: string;
        database: string;
    },
): Promise<VerifyReport> {
    const golden = await readBundle(goldenDir);
    const actual = await captureTopology(superuser);
    return verifyBundles(golden, actual);
}

/** Pure: diff two already-loaded bundles into a report. */
export function verifyBundles(golden: SnapshotBundle, actual: SnapshotBundle): VerifyReport {
    const diffs = diffBundle(golden, actual);
    return {
        goldenCapturedAt: golden.capturedAt,
        actualCapturedAt: actual.capturedAt,
        diffCount: diffs.length,
        diffs,
    };
}
