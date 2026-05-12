import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ENVELOPE_SCHEMA_ID } from '../envelope-schema.ts';
import { emitResult, type OutputFlags } from '../output.ts';
import { newCorrelationId } from '../correlation.ts';
import { asRecord, readString } from '../json.ts';

function readClientVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/commands/version.ts → ../../package.json
  const pkgPath = join(here, '..', '..', 'package.json');
  const raw = readFileSync(pkgPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  const rec = asRecord(parsed);
  if (!rec) return '0.0.0';
  return readString(rec, 'version') ?? '0.0.0';
}

export function runVersion(flags: OutputFlags): void {
  emitResult(flags, {
    correlationId: newCorrelationId(),
    status: 'ok',
    data: {
      client: readClientVersion(),
      schemaContract: ENVELOPE_SCHEMA_ID,
      buildMetadata: {
        commit: process.env['GIT_COMMIT'] ?? 'unknown',
        builtAt: process.env['BUILD_TIME'] ?? 'unknown',
      },
    },
  });
}
