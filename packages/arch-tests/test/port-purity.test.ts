/**
 * Ports define interfaces. Importing a runtime module (`node:*` builtins,
 * a third-party SDK, an adapter) means the interface has leaked
 * implementation. Type-only imports of node-shaped types (`Buffer`,
 * `URL`) are fine — those come from the global TS lib, not `node:*`.
 *
 * dep-cruiser already enforces "ports don't import modules/adapters/apps"
 * via the `ports-no-impls` rule. This file adds the *runtime-builtin*
 * dimension that dep-cruiser's path-based rules don't naturally express.
 *
 * Reference: ports/CLAUDE.md, .dependency-cruiser.cjs ▸ ports-no-impls
 */
import { describe, expect, it } from '@atlas/test';
import { findImportViolations } from './_dependency-scan.ts';
describe('ports/ purity', function () {
    it('ports/src does not import node:crypto', async function () {
        const violations = await findImportViolations('ports/src', /^node:crypto$/);
        expect(violations).toEqual([]);
    });
    it('ports/src does not import node:fs / node:fs/promises', async function () {
        const violations = await findImportViolations('ports/src', /^node:fs(?:\/promises)?$/);
        expect(violations).toEqual([]);
    });
    it('ports/src does not import postgres / pg drivers', async function () {
        const violations = await findImportViolations('ports/src', /^(?:postgres|pg|@databases)(?:\/|$)/);
        expect(violations).toEqual([]);
    });
});
