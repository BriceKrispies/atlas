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

import { filesOfProject } from 'tsarch';
import { describe, expect, it } from 'vitest';

describe('ports/ purity', () => {
  it('ports/src does not import node:crypto', async () => {
    const violations = await filesOfProject()
      .inFolder('ports/src')
      .shouldNot()
      .dependOnFiles()
      .matchingPattern('node:crypto')
      .check();
    expect(violations).toEqual([]);
  });

  it('ports/src does not import node:fs / node:fs/promises', async () => {
    const violations = await filesOfProject()
      .inFolder('ports/src')
      .shouldNot()
      .dependOnFiles()
      .matchingPattern('node:fs')
      .check();
    expect(violations).toEqual([]);
  });

  it('ports/src does not import postgres / pg drivers', async () => {
    const violations = await filesOfProject()
      .inFolder('ports/src')
      .shouldNot()
      .dependOnFiles()
      .matchingPattern('^(postgres|pg|@databases)')
      .check();
    expect(violations).toEqual([]);
  });
});
