#!/usr/bin/env node
/**
 * `pnpm cedar:check` — static analysis of Cedar policy bundles against the
 * generated deployment schema.
 *
 * What it checks:
 *   1. The generated Cedar Schema parses cleanly.
 *   2. Every `*.cedar` fixture under `specs/policy-fixtures/` validates
 *      against that schema (or, for fixtures under
 *      `specs/policy-fixtures/cli/bad-*.cedar`, fails validation as
 *      expected — these are negative-test fixtures).
 *
 * Exit codes:
 *   0 — all positive fixtures validate; all negative fixtures fail (as
 *       intended).
 *   1 — any positive fixture fails, or any negative fixture *passes*
 *       (the negative-test gauntlet inverted).
 *   2 — internal error (cedar-wasm load failure, fixture read failure,
 *       schema generation failure).
 *
 * The CLI deliberately doesn't talk to the database in v1 — fixtures are
 * the source of truth for CI. A future `--from-db` flag can layer in the
 * tenant-bundle snapshot path when the harness is ready.
 *
 * Output is intentionally terse on success (one summary line) and verbose
 * on failure (per-policy diagnostics with file:line where Cedar provides
 * them).
 */

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { moduleManifests } from '@atlas/schemas';
import {
  CedarPolicyEngine,
  BundledFixtureLoader,
  generateCedarSchema,
} from '@atlas/adapters-policy-cedar';
import type {
  ModuleManifest,
  ValidationAnswer,
} from '@atlas/adapters-policy-cedar';

interface FixtureResult {
  path: string;
  isNegative: boolean;
  answer: ValidationAnswer;
}

async function main(): Promise<number> {
  // 1. Generate the schema from the bundled per-module manifests. The
  //    schemas package returns each manifest as `unknown` (raw JSON);
  //    cast to the generator's narrow type — extra fields are ignored.
  const manifests = moduleManifests() as ModuleManifest[];
  const schema = generateCedarSchema(manifests);

  // 2. Locate the policy fixtures directory. We resolve relative to this
  //    file so the CLI works regardless of cwd.
  const here = dirname(fileURLToPath(import.meta.url));
  // bin lives at packages/adapters-policy-cedar/bin/, so 4 levels up.
  const repoRoot = join(here, '..', '..', '..');
  // Scope to `specs/policy-fixtures/cli/` — files there are explicitly
  // CI-gated (positive fixtures that must validate; `bad-*.cedar`
  // negative fixtures that must fail). The top-level
  // `specs/policy-fixtures/*.cedar` set is parity-test fodder + admin-UI
  // showcase; some of those reference actions not yet in the manifest
  // (e.g. badge-family-rbac references Read/Archive/Delete). Bringing
  // them under `cli/` is a follow-up after the manifest grows those
  // actions.
  const fixturesDir = join(repoRoot, 'specs', 'policy-fixtures', 'cli');

  let files: string[];
  try {
    files = await collectCedarFiles(fixturesDir);
  } catch (e) {
    process.stderr.write(
      `cedar:check: failed to read fixtures dir ${fixturesDir}: ${(e as Error).message}\n`,
    );
    return 2;
  }

  if (files.length === 0) {
    process.stderr.write(
      `cedar:check: no .cedar fixtures found under ${fixturesDir}\n`,
    );
    return 2;
  }

  // 3. Boot the engine once (loads cedar-wasm lazily). Empty bundle map —
  //    the CLI is a static analyser, never evaluates.
  const engine = new CedarPolicyEngine(new BundledFixtureLoader(new Map()), {
    schema,
  });

  // 4. Validate each fixture.
  const results: FixtureResult[] = [];
  for (const path of files) {
    const isNegative = basename(path).startsWith('bad-');
    let cedarText: string;
    try {
      cedarText = await readFile(path, 'utf8');
    } catch (e) {
      process.stderr.write(
        `cedar:check: failed to read ${path}: ${(e as Error).message}\n`,
      );
      return 2;
    }
    let answer: ValidationAnswer;
    try {
      answer = await engine.validate(cedarText);
    } catch (e) {
      process.stderr.write(
        `cedar:check: cedar-wasm validate failed on ${path}: ${(e as Error).message}\n`,
      );
      return 2;
    }
    results.push({ path, isNegative, answer });
  }

  // 5. Triage. A positive fixture passes iff `type=='success' && validationErrors.length===0`.
  //    A negative fixture passes iff *the policy fails to validate*.
  let failed = 0;
  for (const r of results) {
    const policyValid = isPolicyValid(r.answer);
    const expectedValid = !r.isNegative;
    if (policyValid === expectedValid) {
      process.stdout.write(`  ok   ${rel(r.path, repoRoot)}\n`);
      continue;
    }

    failed += 1;
    if (r.isNegative) {
      process.stdout.write(
        `  FAIL ${rel(r.path, repoRoot)} — negative fixture validated unexpectedly (should fail validation)\n`,
      );
    } else {
      process.stdout.write(
        `  FAIL ${rel(r.path, repoRoot)} — policy failed schema validation:\n`,
      );
      writeDiagnostics(r.answer);
    }
  }

  const summary = `cedar:check: ${results.length - failed}/${results.length} fixtures ok`;
  if (failed > 0) {
    process.stderr.write(`${summary} (${failed} failed)\n`);
    return 1;
  }
  process.stdout.write(`${summary}\n`);
  return 0;
}

/** Recursively collect `*.cedar` files from a root directory. */
async function collectCedarFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectCedarFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.cedar')) {
      out.push(full);
    }
  }
  return out.sort();
}

function isPolicyValid(answer: ValidationAnswer): boolean {
  if (answer.type === 'failure') return false;
  return answer.validationErrors.length === 0;
}

function writeDiagnostics(answer: ValidationAnswer): void {
  if (answer.type === 'failure') {
    for (const err of answer.errors) {
      process.stdout.write(`    parse: ${err.message}\n`);
    }
    return;
  }
  for (const err of answer.validationErrors) {
    process.stdout.write(`    ${err.policyId}: ${err.error.message}\n`);
  }
}

function rel(path: string, root: string): string {
  return path.startsWith(root) ? path.slice(root.length + 1).replace(/\\/g, '/') : path;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`cedar:check: internal error: ${(e as Error).stack ?? String(e)}\n`);
    process.exit(2);
  });
