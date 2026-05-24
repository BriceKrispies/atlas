/**
 * Subprocess helpers for the dev orchestrator.
 *
 * Two shapes:
 *  - `defaultExec` — captured: buffers stdout/stderr, returns a structured
 *    `ExecResult`. Used for probes + anything we parse (compose detection,
 *    `pg_isready`, container health). Injectable so lifecycle logic is
 *    unit-testable without spawning containers (mirrors the `CheckDeps`
 *    pattern in apps/atlasctl/src/commands/doctor.ts).
 *  - `runStreaming` — inherits stdio so the operator sees live output
 *    (compose build progress, `logs -f`). Used in human mode; --json mode
 *    captures via `defaultExec` instead.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code?: number;
  error?: string;
}

export interface ExecOptions {
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/** Captured exec — runs a binary, buffers output. For probes + parsing. */
export type Exec = (
  bin: string,
  args: ReadonlyArray<string>,
  opts?: ExecOptions,
) => Promise<ExecResult>;

export const defaultExec: Exec = async function defaultExec(bin, args, opts = {}) {
  try {
    const { stdout, stderr } = await execFileP(bin, [...args], {
      timeout: opts.timeoutMs ?? 30_000,
      env: opts.env ?? process.env,
    });
    return { ok: true, stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (e) {
    const err = e as {
      code?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    return {
      ok: false,
      stdout: err.stdout !== undefined ? err.stdout.toString() : '',
      stderr: err.stderr !== undefined ? err.stderr.toString() : '',
      ...(err.code !== undefined ? { code: err.code } : {}),
      ...(err.message !== undefined ? { error: err.message } : {}),
    };
  }
};

/** Streaming run — inherits stdio, resolves with the child's exit code. */
export type Stream = (
  bin: string,
  args: ReadonlyArray<string>,
  opts?: ExecOptions,
) => Promise<number>;

export const runStreaming: Stream = function runStreaming(bin, args, opts = {}) {
  return new Promise(function settle(resolve) {
    const child = spawn(bin, [...args], {
      stdio: 'inherit',
      env: opts.env ?? process.env,
    });
    child.on('error', function onError() {
      resolve(127);
    });
    child.on('exit', function onExit(code) {
      resolve(code ?? 1);
    });
  });
};
