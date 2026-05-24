// @spec scripts/dev orchestrator — output envelope (mirrors atlasctl ResultRecord).
import { describe, expect, it } from '@atlas/test';
import type { Writable } from 'node:stream';
import { emitResult, newCorrelationId } from './output.ts';

function fakeStream() {
  const chunks: string[] = [];
  const w = {
    write(s: string) {
      chunks.push(s);
      return true;
    },
  } as unknown as Writable;
  return { w, text: () => chunks.join('') };
}

describe('emitResult', () => {
  it('--json writes a single JSON line to stdout, nothing to stderr', () => {
    const out = fakeStream();
    const err = fakeStream();
    emitResult(
      { json: true, quiet: false },
      { correlationId: 'c1', status: 'ok', data: { a: 1 } },
      { stdout: out.w, stderr: err.w },
    );
    expect(JSON.parse(out.text())).toEqual({ correlationId: 'c1', status: 'ok', data: { a: 1 } });
    expect(err.text()).toBe('');
  });

  it('human mode writes a status block to stdout', () => {
    const out = fakeStream();
    const err = fakeStream();
    emitResult(
      { json: false, quiet: false },
      { correlationId: 'c1', status: 'ok', message: 'db is up' },
      { stdout: out.w, stderr: err.w },
    );
    expect(out.text()).toContain('status: ok');
    expect(out.text()).toContain('db is up');
  });

  it('routes errors to stderr in human mode', () => {
    const out = fakeStream();
    const err = fakeStream();
    emitResult(
      { json: false, quiet: false },
      { correlationId: 'c1', status: 'error', message: 'boom' },
      { stdout: out.w, stderr: err.w },
    );
    expect(err.text()).toContain('boom');
    expect(out.text()).toBe('');
  });

  it('quiet suppresses ok output but still surfaces errors', () => {
    const out = fakeStream();
    const err = fakeStream();
    emitResult(
      { json: false, quiet: true },
      { correlationId: 'c', status: 'ok', message: 'hi' },
      { stdout: out.w, stderr: err.w },
    );
    expect(out.text()).toBe('');
    emitResult(
      { json: false, quiet: true },
      { correlationId: 'c', status: 'error', message: 'bad' },
      { stdout: out.w, stderr: err.w },
    );
    expect(err.text()).toContain('bad');
  });
});

describe('newCorrelationId', () => {
  it('returns a uuid-shaped string', () => {
    expect(newCorrelationId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
