/**
 * Compose-command resolution.
 *
 * Consolidates logic previously duplicated across the Makefile header,
 * scripts/itest-lifecycle.sh, and apps/atlasctl/src/commands/doctor.ts:
 *
 * Podman 4+'s built-in `podman compose` delegates to an external provider on
 * PATH. On Windows with Docker Desktop installed, that picks up Docker's
 * `docker-compose.exe`, which can't reach the podman named pipe. The
 * standalone `podman-compose` Python tool talks to podman directly and dodges
 * the trap — so we prefer it when present.
 *
 * Override the runtime with CONTAINER_RUNTIME=docker.
 */
import type { Exec } from './exec.ts';

export interface ComposeCmd {
  /** Executable to spawn. */
  bin: string;
  /** Args that precede the compose args (e.g. ['compose'] for `podman compose`). */
  prefixArgs: ReadonlyArray<string>;
  /** Human label for diagnostics. */
  label: string;
}

export function containerRuntime(env: NodeJS.ProcessEnv = process.env): string {
  return env['CONTAINER_RUNTIME'] ?? 'podman';
}

/**
 * Resolve the compose command. Prefers standalone `podman-compose` (probed
 * via `--version`); otherwise falls back to `<runtime> compose`.
 */
export async function detectCompose(
  exec: Exec,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ComposeCmd> {
  const runtime = containerRuntime(env);
  if (runtime === 'podman') {
    const probe = await exec('podman-compose', ['--version'], { timeoutMs: 5_000 });
    if (probe.ok) {
      return { bin: 'podman-compose', prefixArgs: [], label: 'podman-compose' };
    }
  }
  return { bin: runtime, prefixArgs: ['compose'], label: `${runtime} compose` };
}

/** Build the full arg list for a compose invocation against `file`. */
export function composeArgs(
  cmd: ComposeCmd,
  file: string,
  rest: ReadonlyArray<string>,
): string[] {
  return [...cmd.prefixArgs, '-f', file, ...rest];
}
