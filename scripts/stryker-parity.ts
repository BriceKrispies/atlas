#!/usr/bin/env node
/**
 * Stryker oracle/native parity diff.
 *
 * Reads `reports/mutation/oracle-baseline.json` and
 * `reports/mutation/native-latest.json` and asserts per-mutant
 * status parity. Exits 0 if every mutant has the same `status`
 * across both reports; non-zero with a structured diff otherwise.
 *
 * What's NOT diffed:
 *   - `killedBy` test IDs. The oracle uses `["0"]` (opaque "the
 *     pnpm test invocation") for every kill; the native plugin
 *     produces richer per-test IDs. This is strictly more info from
 *     the native side, not a divergence.
 *   - `failureMessage`. Same reason — native is richer; oracle dumps
 *     the entire `pnpm test` stdout into the message.
 *   - `statusReason`. Stryker computes this from `killedBy` /
 *     `failureMessage`, so it follows from above.
 *
 * What IS diffed:
 *   - The mutant universe (same files, same mutant IDs).
 *   - `status` per (file, mutant id). Killed-by-oracle that
 *     Survived-on-native (or vice versa) is the load-bearing parity
 *     failure.
 *
 * Spec: `C:\Users\Brice\.claude\plans\twinkly-popping-deer.md`
 * Stryker Node-Test Runner Plugin plan, Phase 3.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface MutationReport {
  files: Record<string, { mutants: Array<{ id: string; status: string }> }>;
}

const ORACLE = resolve(process.cwd(), 'reports/mutation/oracle-baseline.json');
const NATIVE = resolve(process.cwd(), 'reports/mutation/native-latest.json');

function load(path: string): MutationReport {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as MutationReport;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`parity: cannot read ${path}: ${msg}`);
    console.error(
      `  Run \`pnpm mutation:oracle\` and \`pnpm mutation\` first to generate both reports.`,
    );
    process.exit(2);
  }
}

function index(report: MutationReport): Map<string, string> {
  // key = `${file}::${mutantId}`; value = status
  const out = new Map<string, string>();
  for (const [file, payload] of Object.entries(report.files)) {
    for (const m of payload.mutants) {
      out.set(`${file}::${m.id}`, m.status);
    }
  }
  return out;
}

const oracle = load(ORACLE);
const native = load(NATIVE);
const oracleIdx = index(oracle);
const nativeIdx = index(native);

let divergences = 0;
const missingInNative: string[] = [];
const missingInOracle: string[] = [];
const statusMismatches: Array<{ key: string; oracle: string; native: string }> =
  [];

for (const [key, oStatus] of oracleIdx) {
  const nStatus = nativeIdx.get(key);
  if (nStatus === undefined) {
    missingInNative.push(key);
    divergences++;
    continue;
  }
  if (nStatus !== oStatus) {
    statusMismatches.push({ key, oracle: oStatus, native: nStatus });
    divergences++;
  }
}
for (const [key] of nativeIdx) {
  if (!oracleIdx.has(key)) {
    missingInOracle.push(key);
    divergences++;
  }
}

console.log('=== Stryker oracle ↔ native parity ===');
console.log(`oracle mutants: ${oracleIdx.size}`);
console.log(`native mutants: ${nativeIdx.size}`);
console.log(`divergences:    ${divergences}`);

if (statusMismatches.length > 0) {
  console.log('');
  console.log(`status mismatches (${statusMismatches.length}):`);
  for (const m of statusMismatches.slice(0, 30)) {
    console.log(`  ${m.key}: oracle=${m.oracle} native=${m.native}`);
  }
  if (statusMismatches.length > 30) {
    console.log(`  …and ${statusMismatches.length - 30} more`);
  }
}
if (missingInNative.length > 0) {
  console.log('');
  console.log(`mutants in oracle but not in native (${missingInNative.length}):`);
  for (const k of missingInNative.slice(0, 10)) console.log(`  ${k}`);
  if (missingInNative.length > 10) console.log(`  …`);
}
if (missingInOracle.length > 0) {
  console.log('');
  console.log(`mutants in native but not in oracle (${missingInOracle.length}):`);
  for (const k of missingInOracle.slice(0, 10)) console.log(`  ${k}`);
  if (missingInOracle.length > 10) console.log(`  …`);
}

if (divergences === 0) {
  console.log('');
  console.log('PARITY OK — every mutant agreed across runners.');
  process.exit(0);
}
console.log('');
console.log('PARITY FAILED — see divergences above.');
console.log(
  'Per the Reconciliation Rule (CLAUDE.md), do NOT patch the parity diff —',
);
console.log(
  'write a failing unit test in the plugin that captures the divergent case,',
);
console.log('fix the plugin code, then re-run `pnpm mutation:parity`.');
process.exit(1);
