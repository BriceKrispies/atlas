/**
 * Output envelope for the dev orchestrator. Mirrors the atlasctl envelope
 * (apps/atlasctl/src/output.ts `ResultRecord`) so an agent can parse either
 * tool the same way — but this is a standalone copy on purpose: scripts stay
 * free of app-package imports (same precedent as scripts/dev-up.ts).
 *
 *  --json  → one JSON line to stdout: { correlationId, status, data, message? }
 *  default → human-readable status block
 */
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';

export interface OutputFlags {
  json: boolean;
  quiet: boolean;
}

export interface ResultRecord {
  correlationId: string;
  status: 'ok' | 'warning' | 'error';
  data?: unknown;
  message?: string;
  warnings?: ReadonlyArray<string>;
}

export interface OutputDeps {
  stdout: Writable;
  stderr: Writable;
}

export function newCorrelationId(): string {
  return randomUUID();
}

function defaultDeps(): OutputDeps {
  return { stdout: process.stdout, stderr: process.stderr };
}

export function emitResult(
  flags: OutputFlags,
  result: ResultRecord,
  deps: OutputDeps = defaultDeps(),
): void {
  if (flags.json) {
    deps.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (flags.quiet) {
    if (result.status === 'error') {
      deps.stderr.write(`${result.message ?? 'error'}\n`);
    }
    return;
  }
  const target = result.status === 'error' ? deps.stderr : deps.stdout;
  const lines: string[] = [];
  lines.push(`status: ${result.status}`);
  if (result.message !== undefined) lines.push(result.message);
  if (result.warnings && result.warnings.length > 0) {
    lines.push('warnings:');
    for (const w of result.warnings) lines.push(`  - ${w}`);
  }
  if (result.data !== undefined) {
    lines.push('data:');
    lines.push(JSON.stringify(result.data, null, 2));
  }
  target.write(`${lines.join('\n')}\n`);
}
