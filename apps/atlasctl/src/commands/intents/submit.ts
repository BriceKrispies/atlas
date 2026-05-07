import { readFileSync, readSync } from 'node:fs';
import { request, type ClientOptions } from '../../client.ts';
import { emitResult, type OutputFlags } from '../../output.ts';

export interface SubmitOptions {
  file: string;
  strict: boolean;
}

export async function runSubmit(
  client: ClientOptions,
  opts: SubmitOptions,
  flags: OutputFlags,
): Promise<number> {
  let envelope: unknown;
  try {
    const text = opts.file === '-' ? readStdinSync() : readFileSync(opts.file, 'utf-8');
    envelope = JSON.parse(text);
  } catch (e) {
    emitResult(flags, {
      correlationId: client.correlationId,
      status: 'error',
      message: `failed to read intent: ${(e as Error).message}`,
      errorCode: 'BAD_INPUT',
    });
    return 2;
  }

  // Stamp correlationId into the envelope if missing — the server will
  // also default it, but stamping client-side gives the caller the same
  // ID we display in output.
  if (typeof envelope === 'object' && envelope !== null) {
    const e = envelope as Record<string, unknown>;
    if (e['correlationId'] === undefined) {
      e['correlationId'] = client.correlationId;
    }
  }

  let res;
  try {
    res = await request(client, {
      method: 'POST',
      path: '/api/v1/intents',
      body: envelope,
    });
  } catch (e) {
    emitResult(flags, {
      correlationId: client.correlationId,
      status: 'error',
      message: `request failed: ${(e as Error).message}`,
      errorCode: 'TRANSPORT',
    });
    return 1;
  }

  const ok = res.status >= 200 && res.status < 300;
  if (ok) {
    emitResult(flags, {
      correlationId: res.correlationId,
      status: 'ok',
      httpStatus: res.status,
      data: res.body,
    });
    return 0;
  }

  // Error response. Try to surface the error envelope's code.
  let errorCode: string | undefined;
  let message: string | undefined;
  if (typeof res.body === 'object' && res.body !== null) {
    const b = res.body as Record<string, unknown>;
    if (typeof b['code'] === 'string') errorCode = b['code'];
    if (typeof b['message'] === 'string') message = b['message'];
  }

  emitResult(flags, {
    correlationId: res.correlationId,
    status: 'error',
    httpStatus: res.status,
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(message !== undefined ? { message } : {}),
    data: res.body,
  });
  // strict has no Phase A effect: deprecation surface is Phase B. Reserved.
  void opts.strict;
  return 1;
}

function readStdinSync(): string {
  const chunks: Buffer[] = [];
  let read = 0;
  const buf = Buffer.alloc(65536);
  while ((read = readSync(0, buf)) > 0) {
    chunks.push(Buffer.from(buf.subarray(0, read)));
  }
  return Buffer.concat(chunks).toString('utf-8');
}
