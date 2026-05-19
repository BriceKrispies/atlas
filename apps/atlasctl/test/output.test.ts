import { describe, it, expect } from '@atlas/test';
import { Writable } from 'node:stream';
import { emitResult, type OutputDeps } from '../src/output.ts';
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
function deps(): {
    d: OutputDeps;
    out: MemStream;
    err: MemStream;
} {
    const out = new MemStream();
    const err = new MemStream();
    return { d: { stdout: out, stderr: err }, out, err };
}
describe('emitResult', function () {
    it('JSON mode writes a single JSON line to stdout', function () {
        const { d, out, err } = deps();
        emitResult({ json: true, quiet: false }, { correlationId: 'cid-1', status: 'ok', data: { x: 1 } }, d);
        expect(err.text()).toBe('');
        const parsed = JSON.parse(out.text().trim());
        expect(parsed).toEqual({ correlationId: 'cid-1', status: 'ok', data: { x: 1 } });
    });
    it('quiet mode suppresses ok output', function () {
        const { d, out, err } = deps();
        emitResult({ json: false, quiet: true }, { correlationId: 'cid-1', status: 'ok', message: 'all good' }, d);
        expect(out.text()).toBe('');
        expect(err.text()).toBe('');
    });
    it('quiet mode still emits errors to stderr', function () {
        const { d, out, err } = deps();
        emitResult({ json: false, quiet: true }, { correlationId: 'cid-1', status: 'error', message: 'bad' }, d);
        expect(out.text()).toBe('');
        expect(err.text()).toContain('bad');
    });
    it('human mode includes correlationId in output', function () {
        const { d, out } = deps();
        emitResult({ json: false, quiet: false }, { correlationId: 'cid-42', status: 'ok' }, d);
        expect(out.text()).toContain('correlationId: cid-42');
    });
    it('human mode routes errors to stderr', function () {
        const { d, out, err } = deps();
        emitResult({ json: false, quiet: false }, { correlationId: 'cid-1', status: 'error', errorCode: 'BAD' }, d);
        expect(out.text()).toBe('');
        expect(err.text()).toContain('error: BAD');
    });
});
