/**
 * Pre-baked chaos profiles for common test scenarios. Each is a starting
 * point; integration tests will typically tweak rates per scenario.
 */
import type { ChaosProfile } from './with-chaos.ts';
/** No chaos — a no-op profile. Useful as a control in matrix tests. */
export const NONE: ChaosProfile = Object.freeze({
    defaultMethod: {},
});
/**
 * Light chaos — small latency spikes on every method, very rare errors.
 * Mimics a healthy production environment with normal jitter.
 */
export const LIGHT: ChaosProfile = Object.freeze({
    defaultMethod: {
        error: {
            probability: 0.005,
            factory: function (method: string): Error {
                return new Error(`chaos[light]: synthetic transient error in ${method}`);
            },
        },
        latency: { probability: 0.2, minMs: 1, maxMs: 25 },
    },
});
/**
 * Aggressive chaos — substantial error rate + occasional dropped writes.
 * Use to validate retry / idempotency / dispatcher-rebuild paths under
 * adversarial conditions. Almost no test should pass under this profile
 * the first time; that's the point.
 */
export const AGGRESSIVE: ChaosProfile = Object.freeze({
    defaultMethod: {
        error: {
            probability: 0.05,
            factory: function (method: string, args: readonly unknown[]): Error {
                const argSummary = args
                    .map(function (a: unknown) {
                    return (typeof a === 'string' ? a : typeof a);
                })
                    .slice(0, 2)
                    .join(',');
                return new Error(`chaos[aggressive]: synthetic error in ${method}(${argSummary})`);
            },
        },
        latency: { probability: 0.5, minMs: 10, maxMs: 200 },
        drop: { probability: 0.02 },
    },
});
/**
 * Latency-only — surfaces timeouts, race conditions, and ordering bugs
 * without injecting errors. Good for finding slow-path hot spots.
 */
export const SLOW_NETWORK: ChaosProfile = Object.freeze({
    defaultMethod: {
        latency: { probability: 1, minMs: 100, maxMs: 500 },
    },
});
