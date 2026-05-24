// @spec scripts/dev orchestrator — readiness probe + wait loop (no containers).
import { describe, expect, it } from '@atlas/test';
import type { Exec, ExecResult } from './exec.ts';
import { isContainerHealthy, waitForStack } from './lifecycle.ts';

const noSleep = async (): Promise<void> => {};
const okR = (stdout = ''): ExecResult => ({ ok: true, stdout, stderr: '' });
const failR = (): ExecResult => ({ ok: false, stdout: '', stderr: '', code: 1 });

describe('isContainerHealthy', () => {
  it('is true only for a trimmed "healthy"', () => {
    expect(isContainerHealthy('healthy\n')).toBe(true);
    expect(isContainerHealthy('  healthy  ')).toBe(true);
    expect(isContainerHealthy('starting')).toBe(false);
    expect(isContainerHealthy('')).toBe(false);
  });
});

describe('waitForStack', () => {
  it('returns ready immediately for a none-probe', async () => {
    const o = await waitForStack({ kind: 'none' }, undefined, {
      exec: async () => failR(),
      sleep: noSleep,
      env: {},
    });
    expect(o).toEqual({ ready: true, attempts: 0 });
  });

  it('pg-isready: ready on first ok', async () => {
    const exec: Exec = async () => okR();
    const o = await waitForStack({ kind: 'pg-isready', user: 'u', db: 'd' }, 'c', {
      exec,
      sleep: noSleep,
      env: {},
    }, { maxAttempts: 3, intervalMs: 0 });
    expect(o.ready).toBe(true);
    expect(o.attempts).toBe(1);
  });

  it('pg-isready: retries until ready', async () => {
    let n = 0;
    const exec: Exec = async () => {
      n += 1;
      return n < 3 ? failR() : okR();
    };
    const o = await waitForStack({ kind: 'pg-isready', user: 'u', db: 'd' }, 'c', {
      exec,
      sleep: noSleep,
      env: {},
    }, { maxAttempts: 5, intervalMs: 0 });
    expect(o.ready).toBe(true);
    expect(o.attempts).toBe(3);
  });

  it('container-health: ready when status is healthy', async () => {
    const exec: Exec = async () => okR('healthy');
    const o = await waitForStack({ kind: 'container-health' }, 'c', {
      exec,
      sleep: noSleep,
      env: {},
    }, { maxAttempts: 2, intervalMs: 0 });
    expect(o.ready).toBe(true);
  });

  it('times out → not ready, with a detail', async () => {
    const exec: Exec = async () => failR();
    const o = await waitForStack({ kind: 'pg-isready', user: 'u', db: 'd' }, 'c', {
      exec,
      sleep: noSleep,
      env: {},
    }, { maxAttempts: 2, intervalMs: 0 });
    expect(o.ready).toBe(false);
    expect(o.attempts).toBe(2);
    expect(o.detail).toBeDefined();
  });

  it('honors CONTAINER_RUNTIME for the probe binary', async () => {
    const seen: string[] = [];
    const exec: Exec = async (bin) => {
      seen.push(bin);
      return okR();
    };
    await waitForStack({ kind: 'pg-isready', user: 'u', db: 'd' }, 'c', {
      exec,
      sleep: noSleep,
      env: { CONTAINER_RUNTIME: 'docker' },
    }, { maxAttempts: 1, intervalMs: 0 });
    expect(seen).toContain('docker');
  });

  it('no container configured → not ready', async () => {
    const o = await waitForStack({ kind: 'container-health' }, undefined, {
      exec: async () => okR(),
      sleep: noSleep,
      env: {},
    });
    expect(o.ready).toBe(false);
  });
});
