/**
 * atlasctl logging — runtime log-level + inspection commands.
 *
 * Wraps the apps/server admin-logging routes (`POST/GET
 * /api/v1/admin/logging/...`). Requires admin role on the server side
 * — atlasctl supplies its credential via the standard global flags
 * (--api-key / --token / --debug-principal).
 *
 * Subcommands:
 *
 *   atlasctl logging levels
 *     → GET /api/v1/admin/logging/levels — print snapshot.
 *
 *   atlasctl logging set --global <level>
 *   atlasctl logging set --module <id> <level>
 *   atlasctl logging set --tenant <id> <level>
 *   atlasctl logging set --correlation <id> <level>
 *     → POST to the matching scope.
 *
 *   atlasctl logging clear --module <id>
 *   atlasctl logging clear --tenant <id>
 *   atlasctl logging clear --correlation <id>
 *     → POST { level: null } to the matching scope.
 *
 *   atlasctl logging inspect <correlationId> [--limit <n>]
 *     → GET /api/v1/admin/logging/correlation/:id/recent — print events.
 *
 * Per specs/crosscut/logging.md (level-override precedence) and
 * specs/crosscut/atlasctl.md.
 */

import { request, type ClientOptions } from '../client.ts';
import { emitResult, type OutputFlags } from '../output.ts';

const VALID_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'fatal']);

function isLevelString(s: string): boolean {
  return VALID_LEVELS.has(s);
}

export async function runLoggingLevels(
  client: ClientOptions,
  flags: OutputFlags,
): Promise<number> {
  try {
    const res = await request(client, {
      method: 'GET',
      path: '/api/v1/admin/logging/levels',
    });
    if (res.status !== 200) {
      emitResult(flags, {
        correlationId: res.correlationId,
        status: 'error',
        httpStatus: res.status,
        message: 'failed to fetch logging levels',
        data: res.body,
      });
      return 1;
    }
    emitResult(flags, {
      correlationId: res.correlationId,
      status: 'ok',
      httpStatus: res.status,
      data: res.body,
    });
    return 0;
  } catch (e) {
    emitResult(flags, {
      correlationId: client.correlationId,
      status: 'error',
      message: `request failed: ${(e as Error).message}`,
      errorCode: 'TRANSPORT',
    });
    return 1;
  }
}

export type LoggingScope = 'global' | 'module' | 'tenant' | 'correlation';

export interface RunLoggingSetOptions {
  scope: LoggingScope;
  /** Required for module / tenant / correlation. */
  scopeId?: string;
  /** The level to set. */
  level: string;
}

export async function runLoggingSet(
  client: ClientOptions,
  opts: RunLoggingSetOptions,
  flags: OutputFlags,
): Promise<number> {
  if (!isLevelString(opts.level)) {
    emitResult(flags, {
      correlationId: client.correlationId,
      status: 'error',
      errorCode: 'BAD_INPUT',
      message: `invalid level "${opts.level}" — expected debug | info | warn | error | fatal`,
    });
    return 2;
  }
  const path = pathForScope(opts.scope, opts.scopeId);
  if (path instanceof Error) {
    emitResult(flags, {
      correlationId: client.correlationId,
      status: 'error',
      errorCode: 'BAD_INPUT',
      message: path.message,
    });
    return 2;
  }
  return submitLevelChange(client, flags, path, opts.level);
}

export interface RunLoggingClearOptions {
  /** clear is only valid for module / tenant / correlation — global cannot be cleared. */
  scope: 'module' | 'tenant' | 'correlation';
  scopeId: string;
}

export async function runLoggingClear(
  client: ClientOptions,
  opts: RunLoggingClearOptions,
  flags: OutputFlags,
): Promise<number> {
  const path = pathForScope(opts.scope, opts.scopeId);
  if (path instanceof Error) {
    emitResult(flags, {
      correlationId: client.correlationId,
      status: 'error',
      errorCode: 'BAD_INPUT',
      message: path.message,
    });
    return 2;
  }
  return submitLevelChange(client, flags, path, null);
}

async function submitLevelChange(
  client: ClientOptions,
  flags: OutputFlags,
  path: string,
  level: string | null,
): Promise<number> {
  try {
    const res = await request(client, {
      method: 'POST',
      path,
      body: { level },
    });
    const ok = res.status >= 200 && res.status < 300;
    emitResult(flags, {
      correlationId: res.correlationId,
      status: ok ? 'ok' : 'error',
      httpStatus: res.status,
      data: res.body,
      ...(ok ? {} : { message: 'level change rejected' }),
    });
    return ok ? 0 : 1;
  } catch (e) {
    emitResult(flags, {
      correlationId: client.correlationId,
      status: 'error',
      message: `request failed: ${(e as Error).message}`,
      errorCode: 'TRANSPORT',
    });
    return 1;
  }
}

function pathForScope(scope: LoggingScope, scopeId: string | undefined): string | Error {
  if (scope === 'global') {
    return '/api/v1/admin/logging/levels/global';
  }
  if (scopeId === undefined || scopeId.length === 0) {
    return new Error(
      `${scope} scope requires an id (e.g. --${scope} <id>)`,
    );
  }
  if (scope === 'module') {
    return `/api/v1/admin/logging/levels/module/${encodeURIComponent(scopeId)}`;
  }
  if (scope === 'tenant') {
    return `/api/v1/admin/logging/levels/tenant/${encodeURIComponent(scopeId)}`;
  }
  return `/api/v1/admin/logging/levels/correlation/${encodeURIComponent(scopeId)}`;
}

export interface RunLoggingInspectOptions {
  correlationId: string;
  limit?: number;
}

export async function runLoggingInspect(
  client: ClientOptions,
  opts: RunLoggingInspectOptions,
  flags: OutputFlags,
): Promise<number> {
  const limitParam = opts.limit !== undefined ? `?limit=${opts.limit}` : '';
  const path = `/api/v1/admin/logging/correlation/${encodeURIComponent(
    opts.correlationId,
  )}/recent${limitParam}`;
  try {
    const res = await request(client, { method: 'GET', path });
    const ok = res.status >= 200 && res.status < 300;
    emitResult(flags, {
      correlationId: res.correlationId,
      status: ok ? 'ok' : 'error',
      httpStatus: res.status,
      data: res.body,
      ...(ok ? {} : { message: 'inspection request rejected' }),
    });
    return ok ? 0 : 1;
  } catch (e) {
    emitResult(flags, {
      correlationId: client.correlationId,
      status: 'error',
      message: `request failed: ${(e as Error).message}`,
      errorCode: 'TRANSPORT',
    });
    return 1;
  }
}
