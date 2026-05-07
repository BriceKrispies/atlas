import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { runValidate } from '../src/commands/intents/validate.ts';

class MemStream extends Writable {
  chunks: string[] = [];
  override _write(
    chunk: Buffer | string,
    _enc: BufferEncoding,
    cb: (err?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    cb();
  }
  text(): string {
    return this.chunks.join('');
  }
}

const oldStdoutWrite = process.stdout.write.bind(process.stdout);
const oldStderrWrite = process.stderr.write.bind(process.stderr);

function captureStdio<T>(fn: () => T): { result: T; out: string; err: string } {
  const out = new MemStream();
  const err = new MemStream();
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out.write(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    err.write(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    const result = fn();
    return { result, out: out.text(), err: err.text() };
  } finally {
    process.stdout.write = oldStdoutWrite;
    process.stderr.write = oldStderrWrite;
  }
}

function tmpJson(envelope: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'atlasctl-validate-'));
  const path = join(dir, 'envelope.json');
  writeFileSync(path, JSON.stringify(envelope));
  return path;
}

// NOTE: Atlas's envelope schema enforces schemaId pattern ^[a-z0-9.]+$
// (no underscores or dashes), but every bundled action schema in
// @atlas/schemas has $id like "content_pages.page.create.v1" (with
// underscore). That's a pre-existing inconsistency — atlasctl is
// faithfully rejecting them per the envelope contract. This test uses
// a synthetic pattern-conforming schemaId, which deliberately matches
// no bundled schema → exercises the "no bundled payload schema" warning
// path. When the spec inconsistency is fixed (envelope pattern widened
// or action $ids re-keyed), add a separate test that asserts payload
// validation against a real bundled schema.
const validEnvelope = {
  eventId: '11111111-1111-1111-1111-111111111111',
  eventType: 'Content.PageCreated',
  schemaId: 'synthetic.test.v1',
  schemaVersion: 1,
  occurredAt: '2026-05-07T12:00:00Z',
  tenantId: 'tenant-1',
  correlationId: 'corr-1',
  idempotencyKey: 'idem-1',
  payload: { hello: 'world' },
};

describe('runValidate', () => {
  it('returns 0 for a well-formed envelope', () => {
    const path = tmpJson(validEnvelope);
    const { result, out } = captureStdio(() =>
      runValidate({ file: path }, { json: true, quiet: false }),
    );
    if (result !== 0) {
      throw new Error(`expected result=0 but got ${result}; output: ${out}`);
    }
    const parsed = JSON.parse(out.trim());
    // Either status=ok (payload schema matched) or status=warning (schema not bundled).
    expect(['ok', 'warning']).toContain(parsed.status);
  });

  it('returns 1 when a required envelope field is missing', () => {
    const broken = { ...validEnvelope } as Record<string, unknown>;
    delete broken['tenantId'];
    const path = tmpJson(broken);
    const { result, out } = captureStdio(() =>
      runValidate({ file: path }, { json: true, quiet: false }),
    );
    expect(result).toBe(1);
    const parsed = JSON.parse(out.trim());
    expect(parsed.status).toBe('error');
    expect(parsed.errorCode).toBe('ENVELOPE_INVALID');
  });

  it('returns 2 for malformed JSON input', () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlasctl-validate-'));
    const path = join(dir, 'broken.json');
    writeFileSync(path, '{ not valid json');
    const { result, out } = captureStdio(() =>
      runValidate({ file: path }, { json: true, quiet: false }),
    );
    expect(result).toBe(2);
    const parsed = JSON.parse(out.trim());
    expect(parsed.errorCode).toBe('BAD_INPUT');
  });
});
