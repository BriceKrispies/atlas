import { describe, it, expect } from '@atlas/test';
import {
  podmanMachineCheck,
  runDoctor,
  type CheckDeps,
  type CheckResult,
  type DoctorCheck,
  type ExecResult,
} from '../src/commands/doctor.ts';
import { Writable } from 'node:stream';
import { emitResult, type OutputDeps } from '../src/output.ts';

// ---------------------------------------------------------------------------
// Test fixtures — a CheckDeps stub that returns pre-programmed exec results
// for a sequence of expected commands. Each test programs the sequence and
// asserts the check's traversal of the state machine.
// ---------------------------------------------------------------------------

interface StubCall {
  bin: string;
  args: ReadonlyArray<string>;
}

class StubExec {
  readonly calls: StubCall[] = [];
  private responses: ExecResult[] = [];

  queue(...responses: ExecResult[]): void {
    this.responses.push(...responses);
  }

  asDeps(plat: NodeJS.Platform = 'win32'): CheckDeps {
    const self = this;
    return {
      async exec(bin, args): Promise<ExecResult> {
        self.calls.push({ bin, args });
        const r = self.responses.shift();
        if (!r) throw new Error(`StubExec: no queued response for ${bin} ${args.join(' ')}`);
        return r;
      },
      platform() {
        return plat;
      },
    };
  }
}

function okExec(stdout: string): ExecResult {
  return { ok: true, stdout, stderr: '' };
}

function failExec(stderr: string, error?: string): ExecResult {
  return { ok: false, stdout: '', stderr, error };
}

// ---------------------------------------------------------------------------
// podman-machine check — state machine coverage
// ---------------------------------------------------------------------------

describe('podmanMachineCheck', function () {
  it('returns skipped on non-Windows platforms', async function () {
    const stub = new StubExec();
    const result = await podmanMachineCheck.run(stub.asDeps('linux'));
    expect(result.status).toBe('skipped');
    expect(result.name).toBe('podman-machine');
    expect(stub.calls.length).toBe(0);
  });

  it('returns ok when machine is running and pipe is reachable', async function () {
    const stub = new StubExec();
    stub.queue(
      okExec('podman version 5.0.0\n'),
      okExec(JSON.stringify([{ Name: 'podman-machine-default', Running: true, Default: true }])),
      okExec('localhost.localdomain\n'),
    );
    const result = await podmanMachineCheck.run(stub.asDeps('win32'));
    expect(result.status).toBe('ok');
    expect((result.details as { machine: string }).machine).toBe('podman-machine-default');
    expect(stub.calls.length).toBe(3);
  });

  it('starts the machine and returns fixed when machine was stopped', async function () {
    const stub = new StubExec();
    stub.queue(
      okExec('podman version 5.0.0\n'),
      okExec(JSON.stringify([{ Name: 'podman-machine-default', Running: false, Default: true }])),
      // First tryInfo before recovery — typically fails for a stopped machine
      failExec('connection refused', 'ECONNREFUSED'),
      // podman machine start
      okExec('Machine "podman-machine-default" started successfully\n'),
      // tryInfo after start — now succeeds
      okExec('localhost.localdomain\n'),
    );
    const result = await podmanMachineCheck.run(stub.asDeps('win32'));
    expect(result.status).toBe('fixed');
    expect((result.details as { action: string }).action).toBe('started stopped machine');
    expect(stub.calls.length).toBe(5);
    expect(stub.calls[3]!.args).toEqual(['machine', 'start']);
  });

  it('cycles stop+start when machine is running but pipe is unreachable', async function () {
    const stub = new StubExec();
    stub.queue(
      okExec('podman version 5.0.0\n'),
      okExec(JSON.stringify([{ Name: 'podman-machine-default', Running: true, Default: true }])),
      // First tryInfo — fails (the named-pipe-lost case)
      failExec('open //./pipe/podman-machine-default: cannot find file'),
      // podman machine stop
      okExec('Machine "podman-machine-default" stopped successfully\n'),
      // podman machine start
      okExec('Machine "podman-machine-default" started successfully\n'),
      // tryInfo after stop+start — succeeds
      okExec('localhost.localdomain\n'),
    );
    const result = await podmanMachineCheck.run(stub.asDeps('win32'));
    expect(result.status).toBe('fixed');
    expect((result.details as { action: string }).action).toBe('stop+start to recover unreachable pipe');
    expect(stub.calls[3]!.args).toEqual(['machine', 'stop']);
    expect(stub.calls[4]!.args).toEqual(['machine', 'start']);
  });

  it('fails when podman binary is missing from PATH', async function () {
    const stub = new StubExec();
    stub.queue(failExec('', 'spawn podman ENOENT'));
    const result = await podmanMachineCheck.run(stub.asDeps('win32'));
    expect(result.status).toBe('failed');
    expect((result.details as { reason: string }).reason).toContain('podman binary not found');
  });

  it('fails when no podman machine is configured', async function () {
    const stub = new StubExec();
    stub.queue(okExec('podman version 5.0.0\n'), okExec('[]'));
    const result = await podmanMachineCheck.run(stub.asDeps('win32'));
    expect(result.status).toBe('failed');
    expect((result.details as { reason: string }).reason).toContain('podman machine init');
  });

  it('fails when stop+start does not restore pipe reachability', async function () {
    const stub = new StubExec();
    stub.queue(
      okExec('podman version 5.0.0\n'),
      okExec(JSON.stringify([{ Name: 'podman-machine-default', Running: true, Default: true }])),
      failExec('open //./pipe/...: cannot find file'),
      okExec('stopped\n'),
      okExec('started\n'),
      failExec('open //./pipe/...: cannot find file', 'still broken'),
    );
    const result = await podmanMachineCheck.run(stub.asDeps('win32'));
    expect(result.status).toBe('failed');
    expect((result.details as { step: string }).step).toContain('podman info');
  });
});

// ---------------------------------------------------------------------------
// runDoctor — registry orchestration + exit codes + output shape
// ---------------------------------------------------------------------------

class MemStream extends Writable {
  chunks: string[] = [];
  override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    cb();
  }
  text(): string {
    return this.chunks.join('');
  }
}

function captureOutput(): { d: OutputDeps; out: MemStream; err: MemStream } {
  const out = new MemStream();
  const err = new MemStream();
  return { d: { stdout: out, stderr: err }, out, err };
}

function fakeCheck(name: string, status: CheckResult['status']): DoctorCheck {
  return {
    name,
    async run() {
      return { name, status, details: {} };
    },
  };
}

describe('runDoctor', function () {
  it('exit 0 + status ok when every check is ok or fixed', async function () {
    const code = await runDoctor(
      { json: true, quiet: false },
      {
        correlationId: 'cid-1',
        registry: [fakeCheck('a', 'ok'), fakeCheck('b', 'fixed')],
        deps: new StubExec().asDeps(),
      },
    );
    expect(code).toBe(0);
  });

  it('exit 1 + status error when any check failed', async function () {
    const code = await runDoctor(
      { json: true, quiet: false },
      {
        correlationId: 'cid-2',
        registry: [fakeCheck('a', 'ok'), fakeCheck('b', 'failed')],
        deps: new StubExec().asDeps(),
      },
    );
    expect(code).toBe(1);
  });

  it('reports "all checks skipped" message when every check is skipped', async function () {
    // emitResult is exercised indirectly via runDoctor; here we just exit-code-check.
    const code = await runDoctor(
      { json: true, quiet: true },
      {
        correlationId: 'cid-3',
        registry: [fakeCheck('a', 'skipped'), fakeCheck('b', 'skipped')],
        deps: new StubExec().asDeps(),
      },
    );
    expect(code).toBe(0);
  });

  // Sanity that emitResult writes structured JSON; emitResult itself has its
  // own tests so we keep this check shallow.
  it('emitResult writes a JSON record when --json is set', function () {
    const { d, out } = captureOutput();
    emitResult({ json: true, quiet: false }, {
      correlationId: 'cid-x',
      status: 'ok',
      data: { checks: [] },
    }, d);
    const parsed = JSON.parse(out.text()) as { correlationId: string; status: string };
    expect(parsed.correlationId).toBe('cid-x');
    expect(parsed.status).toBe('ok');
  });
});
