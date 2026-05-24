/**
 * Generic stack lifecycle verbs (up/down/status/logs/reset/wait) + the
 * cross-stack `logs` command. Logic is generic over the STACKS table
 * (stacks.ts); I/O is injected (exec/stream/sleep) so the testable parts —
 * readiness-probe parsing, the wait loop, arg construction — run without
 * spawning containers.
 */
import { composeArgs, containerRuntime, type ComposeCmd } from './compose.ts';
import type { Exec, Stream } from './exec.ts';
import { newCorrelationId, type OutputFlags, type ResultRecord } from './output.ts';
import type { StackDef, WaitProbe } from './stacks.ts';

export interface LifecycleCtx {
  exec: Exec;
  stream: Stream;
  compose: ComposeCmd;
  flags: OutputFlags;
  env: NodeJS.ProcessEnv;
  sleep: (ms: number) => Promise<void>;
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise(function settle(resolve) {
    setTimeout(resolve, ms);
  });
}

// --- readiness probe -------------------------------------------------------

/** `podman inspect` health string check — pure, unit-tested. */
export function isContainerHealthy(stdout: string): boolean {
  return stdout.trim() === 'healthy';
}

export interface WaitOutcome {
  ready: boolean;
  attempts: number;
  detail?: string;
}

export interface WaitDeps {
  exec: Exec;
  sleep: (ms: number) => Promise<void>;
  env: NodeJS.ProcessEnv;
}

/**
 * Poll a stack's readiness probe until ready or the attempt budget is spent.
 * `pg-isready` execs `pg_isready` inside the container (30×1s); container
 * health reads `{{.State.Health.Status}}` (60×2s) — matching the cadence the
 * Makefile used.
 */
export async function waitForStack(
  probe: WaitProbe,
  container: string | undefined,
  deps: WaitDeps,
  opts?: { maxAttempts?: number; intervalMs?: number },
): Promise<WaitOutcome> {
  if (probe.kind === 'none') return { ready: true, attempts: 0 };
  if (container === undefined) {
    return { ready: false, attempts: 0, detail: 'no container configured for probe' };
  }
  const runtime = containerRuntime(deps.env);
  const maxAttempts = opts?.maxAttempts ?? (probe.kind === 'pg-isready' ? 30 : 60);
  const intervalMs = opts?.intervalMs ?? (probe.kind === 'pg-isready' ? 1_000 : 2_000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (probe.kind === 'pg-isready') {
      const r = await deps.exec(
        runtime,
        ['exec', container, 'pg_isready', '-U', probe.user, '-d', probe.db],
        { timeoutMs: 8_000 },
      );
      if (r.ok) return { ready: true, attempts: attempt };
    } else {
      const r = await deps.exec(
        runtime,
        ['inspect', '--format', '{{.State.Health.Status}}', container],
        { timeoutMs: 8_000 },
      );
      if (r.ok && isContainerHealthy(r.stdout)) return { ready: true, attempts: attempt };
    }
    if (attempt < maxAttempts) await deps.sleep(intervalMs);
  }
  return { ready: false, attempts: maxAttempts, detail: 'probe did not report ready within budget' };
}

// --- compose runner --------------------------------------------------------

interface ComposeRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** Stream compose output in human mode; capture it in --json mode. */
async function runCompose(
  ctx: LifecycleCtx,
  stack: StackDef,
  rest: ReadonlyArray<string>,
): Promise<ComposeRun> {
  const args = composeArgs(ctx.compose, stack.composeFile, rest);
  if (ctx.flags.json) {
    const r = await ctx.exec(ctx.compose.bin, args, { env: ctx.env, timeoutMs: 600_000 });
    return { code: r.ok ? 0 : (r.code ?? 1), stdout: r.stdout, stderr: r.stderr };
  }
  const code = await ctx.stream(ctx.compose.bin, args, { env: ctx.env });
  return { code, stdout: '', stderr: '' };
}

function composeFailure(
  correlationId: string,
  stack: StackDef,
  action: string,
  run: ComposeRun,
): ResultRecord {
  return {
    correlationId,
    status: 'error',
    message: `compose ${action} failed for '${stack.name}' (exit ${run.code})`,
    data: {
      stack: stack.name,
      action,
      exitCode: run.code,
      ...(run.stderr ? { stderr: run.stderr } : {}),
    },
  };
}

// --- verbs -----------------------------------------------------------------

export async function up(ctx: LifecycleCtx, stack: StackDef): Promise<ResultRecord> {
  const correlationId = newCorrelationId();
  const run = await runCompose(ctx, stack, ['up', '-d', ...stack.upServices]);
  if (run.code !== 0) return composeFailure(correlationId, stack, 'up', run);

  const outcome = await waitForStack(stack.wait, stack.containerName, ctx);
  return {
    correlationId,
    status: outcome.ready ? 'ok' : 'warning',
    message: outcome.ready
      ? `${stack.name} is up`
      : `${stack.name} started but readiness probe timed out`,
    data: {
      stack: stack.name,
      action: 'up',
      ready: outcome.ready,
      attempts: outcome.attempts,
      urls: stack.urls,
      ...(stack.note !== undefined ? { note: stack.note } : {}),
    },
  };
}

export async function down(ctx: LifecycleCtx, stack: StackDef): Promise<ResultRecord> {
  const correlationId = newCorrelationId();
  const run = await runCompose(ctx, stack, ['down']);
  if (run.code !== 0) return composeFailure(correlationId, stack, 'down', run);
  return {
    correlationId,
    status: 'ok',
    message: `${stack.name} stopped`,
    data: { stack: stack.name, action: 'down' },
  };
}

export async function reset(ctx: LifecycleCtx, stack: StackDef): Promise<ResultRecord> {
  const correlationId = newCorrelationId();
  const run = await runCompose(ctx, stack, ['down', '-v']);
  if (run.code !== 0) return composeFailure(correlationId, stack, 'reset (down -v)', run);
  // Bring it back up (fresh volume). `up` mints its own correlationId; that's
  // fine — the reset is two logical operations.
  return up(ctx, stack);
}

export async function status(ctx: LifecycleCtx, stack: StackDef): Promise<ResultRecord> {
  const correlationId = newCorrelationId();
  // Always capture `ps` so --json can report it; echo it in human mode.
  const ps = await ctx.exec(
    ctx.compose.bin,
    composeArgs(ctx.compose, stack.composeFile, ['ps']),
    { env: ctx.env, timeoutMs: 30_000 },
  );
  if (!ctx.flags.json && ps.stdout) {
    process.stdout.write(ps.stdout.endsWith('\n') ? ps.stdout : `${ps.stdout}\n`);
  }

  const hasProbe = stack.wait.kind !== 'none';
  const probe = hasProbe
    ? await waitForStack(stack.wait, stack.containerName, ctx, { maxAttempts: 1, intervalMs: 0 })
    : undefined;

  return {
    correlationId,
    status: ps.ok ? 'ok' : 'error',
    message: !ps.ok
      ? `failed to query '${stack.name}' status`
      : hasProbe
        ? `${stack.name}: ${probe?.ready ? 'ready' : 'not ready'}`
        : `${stack.name}: see container list`,
    data: {
      stack: stack.name,
      action: 'status',
      urls: stack.urls,
      ...(hasProbe ? { ready: probe?.ready ?? false } : {}),
      ...(ctx.flags.json && ps.stdout ? { ps: ps.stdout.trim() } : {}),
      ...(!ps.ok && ps.stderr ? { stderr: ps.stderr } : {}),
    },
  };
}

export async function waitVerb(ctx: LifecycleCtx, stack: StackDef): Promise<ResultRecord> {
  const correlationId = newCorrelationId();
  if (stack.wait.kind === 'none') {
    return {
      correlationId,
      status: 'ok',
      message: `${stack.name} has no readiness probe`,
      data: { stack: stack.name, action: 'wait', ready: true },
    };
  }
  if (!ctx.flags.json) process.stdout.write(`Waiting for ${stack.name} to become ready...\n`);
  const outcome = await waitForStack(stack.wait, stack.containerName, ctx);
  return {
    correlationId,
    status: outcome.ready ? 'ok' : 'error',
    message: outcome.ready
      ? `${stack.name} ready after ${outcome.attempts} attempt(s)`
      : `${stack.name} did not become ready`,
    data: {
      stack: stack.name,
      action: 'wait',
      ready: outcome.ready,
      attempts: outcome.attempts,
      ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
    },
  };
}

export async function stackLogs(ctx: LifecycleCtx, stack: StackDef): Promise<ResultRecord> {
  const correlationId = newCorrelationId();
  // Human: follow live. --json: capture a snapshot (no follow).
  const rest = ctx.flags.json ? ['logs', '--no-color'] : ['logs', '-f'];
  const run = await runCompose(ctx, stack, rest);
  return {
    correlationId,
    status: run.code === 0 ? 'ok' : 'error',
    message: run.code === 0 ? `${stack.name} logs` : `logs exited ${run.code} for '${stack.name}'`,
    data: {
      stack: stack.name,
      action: 'logs',
      ...(ctx.flags.json && run.stdout ? { logs: run.stdout } : {}),
    },
  };
}

// --- cross-stack container logs -------------------------------------------

export async function containerLogs(
  ctx: LifecycleCtx,
  containers: ReadonlyArray<string>,
  opts: { tail?: number; follow: boolean },
): Promise<ResultRecord> {
  const correlationId = newCorrelationId();
  const runtime = containerRuntime(ctx.env);
  const tailArgs = opts.tail !== undefined ? ['--tail', String(opts.tail)] : [];

  if (ctx.flags.json) {
    // --json forces a snapshot — an infinite follow stream can't be an envelope.
    const r = await ctx.exec(runtime, ['logs', ...tailArgs, ...containers], {
      env: ctx.env,
      timeoutMs: 60_000,
    });
    return {
      correlationId,
      status: r.ok ? 'ok' : 'error',
      message: r.ok ? `logs for ${containers.join(', ')}` : 'failed to read logs',
      data: {
        action: 'logs',
        containers,
        ...(r.stdout ? { logs: r.stdout } : {}),
        ...(!r.ok && r.stderr ? { stderr: r.stderr } : {}),
      },
    };
  }

  const followArgs = opts.follow ? ['-f'] : [];
  const code = await ctx.stream(runtime, ['logs', ...followArgs, ...tailArgs, ...containers], {
    env: ctx.env,
  });
  return {
    correlationId,
    status: code === 0 ? 'ok' : 'error',
    message: code === 0 ? `logs for ${containers.join(', ')}` : `logs exited ${code}`,
    data: { action: 'logs', containers },
  };
}
