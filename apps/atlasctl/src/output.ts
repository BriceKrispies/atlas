import type { Writable } from 'node:stream';

export interface OutputFlags {
  json: boolean;
  quiet: boolean;
}

export interface OutputDeps {
  stdout: Writable;
  stderr: Writable;
}

export function defaultDeps(): OutputDeps {
  return { stdout: process.stdout, stderr: process.stderr };
}

export interface ResultRecord {
  correlationId: string;
  status: 'ok' | 'warning' | 'error';
  data?: unknown;
  message?: string;
  warnings?: ReadonlyArray<string>;
  errorCode?: string;
  httpStatus?: number;
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
  lines.push(`correlationId: ${result.correlationId}`);
  if (result.message !== undefined) lines.push(result.message);
  if (result.errorCode !== undefined) lines.push(`error: ${result.errorCode}`);
  if (result.httpStatus !== undefined) lines.push(`http: ${result.httpStatus}`);
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
