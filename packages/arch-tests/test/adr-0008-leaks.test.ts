/**
 * ADR-0008 Stage 1 plugged four hexagon leaks. These ts-arch tests are
 * the regression net — if any leak sneaks back in (intentional or not),
 * the corresponding test fails and points at the offending file.
 *
 * Each rule cites the ADR clause it enforces. Don't relax a rule without
 * an ADR amendment.
 *
 * Reference: specs/decisions/0008-atlas-on-atlas.md ▸ Decision §3
 *            "The four hexagon leaks (must-plug-first)"
 */

import { filesOfProject } from 'tsarch';
import { describe, expect, it } from 'vitest';

describe('ADR-0008 hexagon leak regression net', () => {
  it('modules/identity does not reach node:crypto directly (Crypto port owns this)', async () => {
    const violations = await filesOfProject()
      .inFolder('modules/identity/src')
      .shouldNot()
      .dependOnFiles()
      .matchingPattern('node:crypto')
      .check();
    expect(violations).toEqual([]);
  });

  it('modules/identity does not reach node:zlib directly (Compression port owns this)', async () => {
    const violations = await filesOfProject()
      .inFolder('modules/identity/src')
      .shouldNot()
      .dependOnFiles()
      .matchingPattern('node:zlib')
      .check();
    expect(violations).toEqual([]);
  });

  it('modules/repository does not reach node:crypto directly', async () => {
    const violations = await filesOfProject()
      .inFolder('modules/repository/src')
      .shouldNot()
      .dependOnFiles()
      .matchingPattern('node:crypto')
      .check();
    expect(violations).toEqual([]);
  });

  it('modules/tenancy does not reach node:crypto directly', async () => {
    const violations = await filesOfProject()
      .inFolder('modules/tenancy/src')
      .shouldNot()
      .dependOnFiles()
      .matchingPattern('node:crypto')
      .check();
    expect(violations).toEqual([]);
  });
});
