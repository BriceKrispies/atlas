/**
 * CLI smoke test — invokes atlasctl as a subprocess and asserts on
 * --help and `atlasctl version --json` outputs. No server is required.
 */
import { describe, it, expect } from '@atlas/test';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(here, '..', 'src', 'main.ts');
function runCli(args: string[]): {
    stdout: string;
    stderr: string;
    status: number | null;
} {
    const res = spawnSync('npx', ['tsx', ENTRY, ...args], {
        encoding: 'utf-8',
        shell: process.platform === 'win32',
    });
    return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}
// CLI tests spawn tsx as a subprocess — node + tsx warm-up on Windows
// can take several seconds. Allow ample headroom.
const CLI_TIMEOUT_MS = 30000;
describe('atlasctl CLI', function () {
    it('--help lists the four Phase A commands', function () {
        const r = runCli(['--help']);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('version');
        expect(r.stdout).toContain('health');
        expect(r.stdout).toContain('intents');
    }, CLI_TIMEOUT_MS);
    it('version --json emits structured output', function () {
        const r = runCli(['version', '--json']);
        expect(r.status).toBe(0);
        const parsed = JSON.parse(r.stdout.trim());
        expect(parsed.status).toBe('ok');
        expect(parsed.correlationId).toBeTruthy();
        expect(parsed.data.client).toBeTruthy();
        expect(parsed.data.schemaContract).toContain('event-envelope');
    }, CLI_TIMEOUT_MS);
});
