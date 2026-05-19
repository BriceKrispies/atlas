/**
 * Bounded pnpm runner. Spawns `pnpm <argv>`, forwards stdio, and kills
 * the child if it doesn't exit before a wallclock deadline. The point is
 * to make pnpm scripts uninterruptible-but-bounded: if a script hangs
 * (vitest leaving file-watchers, a process not flushing stdout, etc.)
 * the wrapper terminates it with a non-zero exit code instead of
 * blocking the parent shell forever.
 *
 * Usage:
 *   pnpm safe <pnpm-args...>          # 5 min default
 *   SAFE_PNPM_TIMEOUT_MS=60000 pnpm safe lint
 *   SAFE_PNPM_TIMEOUT_MS=600000 pnpm safe bdd
 *
 * Exit codes:
 *   0–N   forwarded from the child
 *   124   timed out (matches GNU `timeout(1)`)
 *   2     bad invocation
 */
import { spawn, spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('usage: pnpm safe <pnpm-args...>');
    process.exit(2);
}
const timeoutMs = Number(process.env['SAFE_PNPM_TIMEOUT_MS'] ?? 300000);
const killGraceMs = Number(process.env['SAFE_PNPM_KILL_GRACE_MS'] ?? 5000);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error(`[safe-pnpm] invalid SAFE_PNPM_TIMEOUT_MS: ${process.env['SAFE_PNPM_TIMEOUT_MS']}`);
    process.exit(2);
}
const isWindows = process.platform === 'win32';
// Windows can't directly spawn `.cmd` shims (Node 20+ blocks it for safety).
// Going through the shell gets `pnpm` resolved via cmd.exe / sh; the child
// pid is the shell, and we kill the whole process tree on timeout because
// SIGTERM to the shell alone won't reach pnpm or its grandchildren.
const child = spawn('pnpm', args, { stdio: 'inherit', shell: true });
function killTree(pid: number, hard: boolean): void {
    if (isWindows) {
        // `taskkill /T /F` kills the whole tree by PID. Without /F it only
        // closes graceful-exit-aware processes; vitest doesn't qualify.
        spawnSync('taskkill', hard ? ['/PID', String(pid), '/T', '/F'] : ['/PID', String(pid), '/T'], { stdio: 'ignore' });
    }
    else {
        try {
            // Negative PID = process group, requires the child to be a session leader.
            // Without detached:true the child is in our group; just signal directly.
            process.kill(pid, hard ? 'SIGKILL' : 'SIGTERM');
        }
        catch {
            // Already dead.
        }
    }
}
let timedOut = false;
const deadline = setTimeout(function () {
    timedOut = true;
    process.stderr.write(`\n[safe-pnpm] timeout after ${timeoutMs}ms — terminating\n`);
    if (child.pid !== undefined)
        killTree(child.pid, false);
    setTimeout(function () {
        if (child.exitCode === null && child.pid !== undefined) {
            process.stderr.write('[safe-pnpm] still alive — force-killing\n');
            killTree(child.pid, true);
        }
    }, killGraceMs).unref();
}, timeoutMs);
const forward = function (sig: NodeJS.Signals): void {
    if (child.exitCode === null && child.pid !== undefined) {
        if (isWindows)
            killTree(child.pid, false);
        else
            child.kill(sig);
    }
};
process.on('SIGINT', function () {
    return forward('SIGINT');
});
process.on('SIGTERM', function () {
    return forward('SIGTERM');
});
child.on('error', function (err) {
    clearTimeout(deadline);
    process.stderr.write(`[safe-pnpm] failed to spawn pnpm: ${err.message}\n`);
    process.exit(127);
});
child.on('exit', function (code, signal) {
    clearTimeout(deadline);
    if (timedOut) {
        process.exit(124);
    }
    if (signal && !isWindows) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 1);
});
