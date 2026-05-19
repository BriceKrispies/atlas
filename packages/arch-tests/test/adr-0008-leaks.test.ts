/**
 * ADR-0008 Stage 1 plugged four hexagon leaks. These arch tests are
 * the regression net — if any leak sneaks back in (intentional or not),
 * the corresponding test fails and points at the offending file.
 *
 * Each rule cites the ADR clause it enforces. Don't relax a rule without
 * an ADR amendment.
 *
 * Reference: specs/decisions/0008-atlas-on-atlas.md ▸ Decision §3
 *            "The four hexagon leaks (must-plug-first)"
 */
import { describe, expect, it } from 'vitest';
import { findImportViolations } from './_dependency-scan.ts';
describe('ADR-0008 hexagon leak regression net', function () {
    it('modules/identity does not reach node:crypto directly (Crypto port owns this)', async function () {
        const violations = await findImportViolations('modules/identity/src', /^node:crypto$/);
        expect(violations).toEqual([]);
    });
    it('modules/identity does not reach node:zlib directly (Compression port owns this)', async function () {
        const violations = await findImportViolations('modules/identity/src', /^node:zlib$/);
        expect(violations).toEqual([]);
    });
    it('modules/repository does not reach node:crypto directly', async function () {
        const violations = await findImportViolations('modules/repository/src', /^node:crypto$/);
        expect(violations).toEqual([]);
    });
    it('modules/tenancy does not reach node:crypto directly', async function () {
        const violations = await findImportViolations('modules/tenancy/src', /^node:crypto$/);
        expect(violations).toEqual([]);
    });
});
