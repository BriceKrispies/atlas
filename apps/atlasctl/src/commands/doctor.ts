/**
 * atlasctl doctor — local-environment diagnose + auto-recover.
 *
 * Phase A scope per specs/crosscut/atlasctl.md "Doctor — Phase A". Runs a
 * registry of checks against the operator's local machine (NOT against the
 * running Atlas deployment — that's `health`). Each check returns one of
 * `ok` / `fixed` / `failed` / `skipped` and may attempt auto-recovery.
 *
 * Adding a new check is a single push into `DEFAULT_REGISTRY` below — no
 * main.ts edit needed.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { emitResult, type OutputFlags } from '../output.ts';

const execFileP = promisify(execFile);

export type CheckStatus = 'ok' | 'fixed' | 'failed' | 'skipped';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  details: Record<string, unknown>;
}

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code?: number;
  error?: string;
}

export interface CheckDeps {
  exec(bin: string, args: ReadonlyArray<string>, timeoutMs: number): Promise<ExecResult>;
  platform(): NodeJS.Platform;
}

export interface DoctorCheck {
  name: string;
  run(deps: CheckDeps): Promise<CheckResult>;
}

const defaultDeps: CheckDeps = {
  async exec(bin, args, timeoutMs) {
    try {
      const { stdout, stderr } = await execFileP(bin, [...args], { timeout: timeoutMs });
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
        code: err.code,
        error: err.message,
      };
    }
  },
  platform() {
    return process.platform;
  },
};

interface PodmanMachine {
  Name: string;
  Running: boolean;
  Default: boolean;
}

export const podmanMachineCheck: DoctorCheck = {
  name: 'podman-machine',

  async run(deps: CheckDeps): Promise<CheckResult> {
    if (deps.platform() !== 'win32') {
      return {
        name: this.name,
        status: 'skipped',
        details: { reason: 'podman-machine pipe recovery is Windows-specific' },
      };
    }

    // Step 1 — binary on PATH?
    const versionR = await deps.exec('podman', ['--version'], 5_000);
    if (!versionR.ok) {
      return {
        name: this.name,
        status: 'failed',
        details: {
          step: 'podman --version',
          reason: 'podman binary not found on PATH or not executable',
          stderr: versionR.stderr,
          error: versionR.error,
        },
      };
    }

    // Step 2 — list machines
    const listR = await deps.exec('podman', ['machine', 'list', '--format', 'json'], 10_000);
    if (!listR.ok) {
      return {
        name: this.name,
        status: 'failed',
        details: { step: 'podman machine list', stderr: listR.stderr, error: listR.error },
      };
    }

    let machines: PodmanMachine[];
    try {
      machines = JSON.parse(listR.stdout) as PodmanMachine[];
    } catch (e) {
      return {
        name: this.name,
        status: 'failed',
        details: {
          step: 'parse podman machine list',
          stdout: listR.stdout,
          error: (e as Error).message,
        },
      };
    }

    if (!Array.isArray(machines) || machines.length === 0) {
      return {
        name: this.name,
        status: 'failed',
        details: { reason: 'no podman machine configured — run `podman machine init` first' },
      };
    }

    const target = machines.find(function (m) {
      return m.Default;
    }) ?? machines[0];

    // The `?? machines[0]` makes target non-undefined at runtime when the
    // array is non-empty (checked above), but TS doesn't narrow array
    // index access. Guard explicitly to satisfy strict TS without a cast.
    if (!target) {
      return {
        name: this.name,
        status: 'failed',
        details: { reason: 'unexpectedly empty machine list after non-zero length check' },
      };
    }

    // Step 3 — pipe reachability probe
    async function tryInfo(): Promise<ExecResult> {
      return deps.exec('podman', ['info', '--format', '{{.Host.Hostname}}'], 8_000);
    }

    let infoR = await tryInfo();

    // Case: machine stopped — start it
    if (!target.Running) {
      const startR = await deps.exec('podman', ['machine', 'start'], 120_000);
      if (!startR.ok) {
        return {
          name: this.name,
          status: 'failed',
          details: {
            step: 'podman machine start (machine was stopped)',
            stderr: startR.stderr,
            error: startR.error,
          },
        };
      }
      infoR = await tryInfo();
      if (infoR.ok) {
        return {
          name: this.name,
          status: 'fixed',
          details: {
            action: 'started stopped machine',
            machine: target.Name,
            hostname: infoR.stdout.trim(),
          },
        };
      }
      // Fell through — pipe still unreachable; try stop+start cycle below.
    }

    if (infoR.ok) {
      return {
        name: this.name,
        status: 'ok',
        details: { machine: target.Name, hostname: infoR.stdout.trim() },
      };
    }

    // Case: machine reports running but `podman info` fails — typically the
    // named-pipe lease was lost on a host reboot. Stop + start to recreate.
    const stopR = await deps.exec('podman', ['machine', 'stop'], 60_000);
    // We tolerate a stop failure (machine may be in a half-running state
    // where stop is a no-op or errors); the subsequent start is what
    // re-establishes the pipe. The stop stderr is preserved for diagnostics
    // only if the start also fails.
    const startR = await deps.exec('podman', ['machine', 'start'], 120_000);
    if (!startR.ok) {
      return {
        name: this.name,
        status: 'failed',
        details: {
          step: 'podman machine start (after stop)',
          stderr: startR.stderr,
          error: startR.error,
          stopStderr: stopR.stderr,
          stopError: stopR.error,
        },
      };
    }

    infoR = await tryInfo();
    if (infoR.ok) {
      return {
        name: this.name,
        status: 'fixed',
        details: {
          action: 'stop+start to recover unreachable pipe',
          machine: target.Name,
          hostname: infoR.stdout.trim(),
        },
      };
    }

    return {
      name: this.name,
      status: 'failed',
      details: {
        step: 'podman info (after stop+start recovery)',
        stderr: infoR.stderr,
        error: infoR.error,
      },
    };
  },
};

export const podmanComposeProviderCheck: DoctorCheck = {
  name: 'podman-compose-provider',

  async run(deps: CheckDeps): Promise<CheckResult> {
    if (deps.platform() !== 'win32') {
      // On Linux / macOS the external-provider delegation isn't pathological;
      // `podman compose` falls through to a working docker-compose (rare in
      // dev) or to podman-compose if available. The failure mode this check
      // catches is Windows-specific: Docker Desktop's `docker-compose.exe`
      // is the external provider but cannot reach the podman pipe.
      return {
        name: this.name,
        status: 'skipped',
        details: { reason: 'compose-provider delegation issue is Windows-specific' },
      };
    }

    // Prefer the standalone podman-compose Python tool if present — it
    // talks to podman directly and dodges the external-provider trap.
    const pcVersionR = await deps.exec('podman-compose', ['--version'], 5_000);
    if (pcVersionR.ok) {
      return {
        name: this.name,
        status: 'ok',
        details: {
          provider: 'podman-compose',
          version: pcVersionR.stdout.trim().split('\n').slice(-1)[0],
          note: 'Makefile auto-detects this and uses it for `make db-up`',
        },
      };
    }

    // No standalone tool — `podman compose` will delegate. Probe what the
    // delegation finds.
    const composeR = await deps.exec('podman', ['compose', 'version'], 10_000);
    const composeText = (composeR.stdout + composeR.stderr).toLowerCase();
    const delegatesToDocker =
      composeText.includes('docker-compose') || composeText.includes('docker\\compose');

    if (composeR.ok && !delegatesToDocker) {
      // `podman compose` worked AND wasn't routed through docker-compose
      // — likely a native podman compose ship. Healthy.
      return {
        name: this.name,
        status: 'ok',
        details: {
          provider: 'podman compose (native)',
          stdout: composeR.stdout.trim(),
        },
      };
    }

    // Either compose failed outright, or it delegated to docker-compose
    // (and may have appeared to succeed for `version` but will fail for
    // `up -d` against the podman pipe). Surface the actionable diagnostic.
    return {
      name: this.name,
      status: 'failed',
      details: {
        reason: 'no standalone podman-compose installed; `podman compose` delegates to docker-compose which cannot reach the podman pipe on Windows',
        fix: 'install podman-compose via `pip install podman-compose` (or `pipx install podman-compose`); the Atlas Makefile auto-detects it and prefers it over `podman compose`',
        delegatesToDocker,
        composeOk: composeR.ok,
        stderr: composeR.stderr,
      },
    };
  },
};

const DEFAULT_REGISTRY: ReadonlyArray<DoctorCheck> = [podmanMachineCheck, podmanComposeProviderCheck];

export interface DoctorOpts {
  correlationId: string;
  registry?: ReadonlyArray<DoctorCheck>;
  deps?: CheckDeps;
}

export async function runDoctor(flags: OutputFlags, opts: DoctorOpts): Promise<number> {
  const registry = opts.registry ?? DEFAULT_REGISTRY;
  const deps = opts.deps ?? defaultDeps;
  const results: CheckResult[] = [];
  for (const check of registry) {
    results.push(await check.run(deps));
  }
  const failedCount = results.filter(function (r) {
    return r.status === 'failed';
  }).length;
  const allSkipped = results.every(function (r) {
    return r.status === 'skipped';
  });
  const message =
    failedCount > 0
      ? `${failedCount} check(s) failed`
      : allSkipped
        ? 'all checks skipped on this platform'
        : undefined;
  emitResult(flags, {
    correlationId: opts.correlationId,
    status: failedCount > 0 ? 'error' : 'ok',
    data: { checks: results },
    ...(message !== undefined ? { message } : {}),
  });
  return failedCount > 0 ? 1 : 0;
}
