#!/usr/bin/env node
/**
 * devctl — Atlas dev orchestrator.
 *
 * Host-side container/stack lifecycle for local development. NOT a product
 * surface and NOT a replacement for `atlasctl` (the shipped HTTP client) —
 * where it needs the running instance it shells out to `atlasctl`.
 *
 * Usage:
 *   pnpm devctl stack <db|keycloak|obs|smtp> <up|down|status|logs|reset|wait> [--json]
 *   pnpm devctl logs <service...> [--tail N] [--no-follow] [--json]
 *
 * Global flags: --json (machine-readable envelope), --quiet.
 *
 * Runtime: Node built-in type-stripping (`node --experimental-transform-types`),
 * the same runtime every other Atlas script uses. CONTAINER_RUNTIME=docker to
 * override podman.
 */
import { pathToFileURL } from 'node:url';
import { detectCompose } from './compose.ts';
import { defaultExec, runStreaming } from './exec.ts';
import {
  containerLogs,
  defaultSleep,
  down,
  reset,
  stackLogs,
  status,
  up,
  waitVerb,
  type LifecycleCtx,
} from './lifecycle.ts';
import { emitResult, type OutputFlags, type ResultRecord } from './output.ts';
import { findStack, resolveContainer, stackNames, type StackDef } from './stacks.ts';

const STACK_VERBS = ['up', 'down', 'status', 'logs', 'reset', 'wait'] as const;
export type StackVerb = (typeof STACK_VERBS)[number];

export type ParsedCommand =
  | { kind: 'stack'; stack: string; verb: StackVerb; flags: OutputFlags }
  | { kind: 'logs'; services: string[]; tail?: number; follow: boolean; flags: OutputFlags }
  | { kind: 'help'; flags: OutputFlags }
  | { kind: 'error'; message: string; flags: OutputFlags };

function isStackVerb(v: string): v is StackVerb {
  return (STACK_VERBS as ReadonlyArray<string>).includes(v);
}

/** Pure arg parser — no I/O, unit-tested. */
export function parseArgv(argv: ReadonlyArray<string>): ParsedCommand {
  const positionals: string[] = [];
  // Global flags are position-independent: pre-scan so an early parse error
  // still respects --json (the agentic contract) even when --json trails the
  // offending argument.
  const flags: OutputFlags = {
    json: argv.includes('--json'),
    quiet: argv.includes('--quiet') || argv.includes('-q'),
  };
  let follow = true;
  let tail: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--json') flags.json = true;
    else if (arg === '--quiet' || arg === '-q') flags.quiet = true;
    else if (arg === '--no-follow') follow = false;
    else if (arg === '--tail' || arg === '-n') {
      const next = argv[i + 1];
      const n = Number(next);
      if (next === undefined || !Number.isFinite(n)) {
        return { kind: 'error', message: `--tail requires a number, got '${next ?? ''}'`, flags };
      }
      tail = n;
      i++;
    } else if (arg.startsWith('--tail=')) {
      const n = Number(arg.slice('--tail='.length));
      if (!Number.isFinite(n)) return { kind: 'error', message: `--tail requires a number`, flags };
      tail = n;
    } else if (arg === '-h' || arg === '--help') {
      return { kind: 'help', flags };
    } else if (arg.startsWith('-')) {
      return { kind: 'error', message: `unknown flag: ${arg}`, flags };
    } else {
      positionals.push(arg);
    }
  }

  const command = positionals[0];
  if (command === undefined || command === 'help') return { kind: 'help', flags };

  if (command === 'stack') {
    const stack = positionals[1];
    const verb = positionals[2];
    if (stack === undefined || verb === undefined) {
      return { kind: 'error', message: 'usage: devctl stack <name> <verb>', flags };
    }
    if (!isStackVerb(verb)) {
      return { kind: 'error', message: `unknown verb '${verb}' (expected: ${STACK_VERBS.join(', ')})`, flags };
    }
    return { kind: 'stack', stack, verb, flags };
  }

  if (command === 'logs') {
    const services = positionals.slice(1);
    if (services.length === 0) {
      return { kind: 'error', message: 'usage: devctl logs <service...>', flags };
    }
    return { kind: 'logs', services, follow, flags, ...(tail !== undefined ? { tail } : {}) };
  }

  return { kind: 'error', message: `unknown command '${command}'`, flags };
}

const USAGE = `devctl — Atlas dev orchestrator

Usage:
  devctl stack <name> <verb> [--json] [--quiet]
  devctl logs <service...> [--tail N] [--no-follow] [--json]

Stacks: ${stackNames().join(', ')}
Verbs:  ${STACK_VERBS.join(', ')}

Examples:
  pnpm devctl stack db up
  pnpm devctl stack db status --json
  pnpm devctl stack keycloak wait
  pnpm devctl logs db --tail 100 --no-follow

Env: CONTAINER_RUNTIME=docker overrides podman.
`;

function exitCodeFor(status_: ResultRecord['status']): number {
  return status_ === 'error' ? 1 : 0;
}

async function dispatch(parsed: ParsedCommand): Promise<number> {
  if (parsed.kind === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.kind === 'error') {
    emitResult(parsed.flags, {
      correlationId: '-',
      status: 'error',
      message: parsed.message,
    });
    return 2;
  }

  const compose = await detectCompose(defaultExec);
  const ctx: LifecycleCtx = {
    exec: defaultExec,
    stream: runStreaming,
    compose,
    flags: parsed.flags,
    env: process.env,
    sleep: defaultSleep,
  };

  if (parsed.kind === 'logs') {
    const containers: string[] = [];
    for (const svc of parsed.services) {
      const c = resolveContainer(svc);
      if (c === undefined) {
        emitResult(parsed.flags, {
          correlationId: '-',
          status: 'error',
          message: `unknown service '${svc}'`,
        });
        return 1;
      }
      containers.push(c);
    }
    const result = await containerLogs(ctx, containers, {
      follow: parsed.follow,
      ...(parsed.tail !== undefined ? { tail: parsed.tail } : {}),
    });
    emitResult(parsed.flags, result);
    return exitCodeFor(result.status);
  }

  // kind === 'stack'
  const stack = findStack(parsed.stack);
  if (stack === undefined) {
    emitResult(parsed.flags, {
      correlationId: '-',
      status: 'error',
      message: `unknown stack '${parsed.stack}' (expected: ${stackNames().join(', ')})`,
    });
    return 1;
  }

  const verbFns: Record<StackVerb, (c: LifecycleCtx, s: StackDef) => Promise<ResultRecord>> = {
    up,
    down,
    status,
    logs: stackLogs,
    reset,
    wait: waitVerb,
  };
  const result = await verbFns[parsed.verb](ctx, stack);
  emitResult(parsed.flags, result);
  return exitCodeFor(result.status);
}

async function main(): Promise<void> {
  const parsed = parseArgv(process.argv.slice(2));
  const code = await dispatch(parsed);
  process.exitCode = code;
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch(function onError(e: unknown) {
    process.stderr.write(`devctl failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
