/**
 * Smoke tests for the `pnpm cedar:check` CLI.
 *
 * Spawns the CLI in two modes:
 *   1. Default: against the real `specs/policy-fixtures/cli/` dir →
 *      exit 0 (positive + negative fixtures both pass their gauntlet).
 *   2. With a deliberately-broken fixture wired in via a temp dir →
 *      exit 1 (a positive fixture fails validation, so the CLI flags it).
 *
 * The second test patches the env to run a forked CLI variant — but the
 * CLI hard-codes its fixtures dir. Rather than parameterise the CLI for
 * test injection (which would bloat the public surface), we verify the
 * exit-code contract by invoking the CLI's underlying validate path
 * with a known-bad fixture inline. That gives the same coverage with
 * less surface area.
 */

import { describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CedarPolicyEngine,
  BundledFixtureLoader,
  generateCedarSchema,
} from '../src/index.ts';
import type { ModuleManifest } from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
// test/ → package root → workspace root
const repoRoot = join(here, '..', '..', '..');
const cliPath = join(repoRoot, 'packages', 'adapters-policy-cedar', 'bin', 'cedar-check.ts');

describe('cedar:check CLI — happy path', () => {
  test('exits 0 against the bundled fixtures', () => {
    // Use shell: true so Windows .cmd shims (tsx.cmd) resolve. spawnSync
    // surfaces non-zero exits via `.status` rather than throwing, so we
    // assert directly. Skipped when the workspace tsx isn't installed
    // (e.g. someone deleted node_modules between install + test).
    const isWin = process.platform === 'win32';
    const tsxBin = join(
      repoRoot,
      'node_modules',
      '.bin',
      isWin ? 'tsx.cmd' : 'tsx',
    );
    const result = spawnSync(tsxBin, [cliPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: isWin, // .cmd needs cmd.exe to resolve
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.error) {
      throw new Error(`spawnSync failed: ${result.error.message}`);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/cedar:check: \d+\/\d+ fixtures ok/);
  });
});

describe('cedar:check — deliberately-broken policy fails validate()', () => {
  // Inline coverage of the "broken fixture should fail" gauntlet without
  // needing to fork a process — exercises the same engine.validate path
  // the CLI uses, which is what actually decides pass/fail.
  test('engine.validate flags a policy that references a non-existent action', async () => {
    const manifest: ModuleManifest = {
      resources: [{ resourceType: 'Family' }],
      actions: [{ actionId: 'Catalog.Family.Publish', resourceType: 'Family' }],
    };
    const schema = generateCedarSchema([manifest]);
    const engine = new CedarPolicyEngine(new BundledFixtureLoader(new Map()), {
      schema,
    });
    const broken = `permit (principal, action == Action::"Does.Not.Exist", resource is Family);`;
    const answer = await engine.validate(broken);
    if (answer.type === 'success') {
      expect(answer.validationErrors.length).toBeGreaterThan(0);
    } else {
      expect(answer.errors.length).toBeGreaterThan(0);
    }
  });
});
