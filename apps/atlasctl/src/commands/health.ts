import { request, type ClientOptions } from '../client.ts';
import { emitResult, type OutputFlags } from '../output.ts';

export async function runHealth(
  client: ClientOptions,
  flags: OutputFlags,
): Promise<number> {
  const liveness = await safeRequest(client, '/healthz');
  const readiness = await safeRequest(client, '/readyz');

  const allOk = liveness.ok && readiness.ok;
  emitResult(flags, {
    correlationId: client.correlationId,
    status: allOk ? 'ok' : 'error',
    data: {
      healthz: liveness,
      readyz: readiness,
    },
    ...(allOk ? {} : { message: 'one or more health probes did not return 200' }),
  });
  return allOk ? 0 : 1;
}

interface ProbeResult {
  ok: boolean;
  status: number;
  body: unknown;
  error?: string;
}

async function safeRequest(client: ClientOptions, path: string): Promise<ProbeResult> {
  try {
    const res = await request(client, { method: 'GET', path });
    return { ok: res.status === 200, status: res.status, body: res.body };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      body: null,
      error: (e as Error).message,
    };
  }
}
