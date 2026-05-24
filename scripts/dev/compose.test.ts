// @spec scripts/dev orchestrator — compose-command resolution.
// Covers the Windows podman-compose-provider trap documented in the Makefile
// header + apps/atlasctl/src/commands/doctor.ts.
import { describe, expect, it } from '@atlas/test';
import { composeArgs, containerRuntime, detectCompose } from './compose.ts';
import type { Exec, ExecResult } from './exec.ts';

const ok = (stdout = ''): ExecResult => ({ ok: true, stdout, stderr: '' });
const fail = (): ExecResult => ({ ok: false, stdout: '', stderr: 'not found', code: 1 });

describe('detectCompose', () => {
  it('prefers standalone podman-compose when present', async () => {
    const exec: Exec = async (bin) => (bin === 'podman-compose' ? ok('1.0.6') : fail());
    const cmd = await detectCompose(exec, {});
    expect(cmd.bin).toBe('podman-compose');
    expect(cmd.prefixArgs).toEqual([]);
  });

  it('falls back to `podman compose` when podman-compose absent', async () => {
    const exec: Exec = async () => fail();
    const cmd = await detectCompose(exec, {});
    expect(cmd.bin).toBe('podman');
    expect(cmd.prefixArgs).toEqual(['compose']);
  });

  it('uses `docker compose` under CONTAINER_RUNTIME=docker and skips the podman-compose probe', async () => {
    let probed = false;
    const exec: Exec = async (bin) => {
      if (bin === 'podman-compose') probed = true;
      return fail();
    };
    const cmd = await detectCompose(exec, { CONTAINER_RUNTIME: 'docker' });
    expect(cmd.bin).toBe('docker');
    expect(cmd.prefixArgs).toEqual(['compose']);
    expect(probed).toBe(false);
  });
});

describe('composeArgs', () => {
  it('prepends prefix args + `-f <file>`', () => {
    const args = composeArgs(
      { bin: 'podman', prefixArgs: ['compose'], label: 'podman compose' },
      '/x/compose.yml',
      ['up', '-d', 'postgres'],
    );
    expect(args).toEqual(['compose', '-f', '/x/compose.yml', 'up', '-d', 'postgres']);
  });
});

describe('containerRuntime', () => {
  it('defaults to podman', () => expect(containerRuntime({})).toBe('podman'));
  it('honors CONTAINER_RUNTIME override', () =>
    expect(containerRuntime({ CONTAINER_RUNTIME: 'docker' })).toBe('docker'));
});
