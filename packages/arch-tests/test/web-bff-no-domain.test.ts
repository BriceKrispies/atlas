/**
 * ADR 0017: apps/web-bff is a trusted EDGE proxy, not a second domain door.
 * Its I1-safety rests on holding NO domain code — it may import @atlas/web-abi
 * and nothing else from the workspace, and no DB driver. The ring matrix
 * (arch:check) already forbids every non-web-abi @atlas import as a
 * cross-stack / non-listed-ring violation; this test is the belt-and-suspenders
 * regression net keyed to the exact danger surface (domain/adapter/DB).
 *
 * If this fails, web-bff has grown a path into the domain that bypasses
 * apps/server's ingress — an I1 (single domain ingress) regression.
 *
 * Reference: specs/decisions/0017-two-kernel-frontend-architecture.md §4,
 *            specs/frontend/web-bff.md.
 */
import { describe, expect, it } from '@atlas/test';
import { findImportViolations } from './_dependency-scan.ts';

describe('apps/web-bff domain isolation (ADR 0017 §4)', function () {
  it('imports no @atlas/* except @atlas/web-abi, and no DB driver', async function () {
    // Forbid: any pg/postgres driver, and any @atlas/* that is NOT @atlas/web-abi.
    const violations = await findImportViolations(
      'apps/web-bff/src',
      /^(pg|postgres)(\/|$)|^@atlas\/(?!web-abi(\/|$))/,
    );
    expect(violations).toEqual([]);
  });
});
