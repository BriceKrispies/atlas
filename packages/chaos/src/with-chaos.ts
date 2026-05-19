/**
 * `withChaos(adapter, profile)` — adapter-layer fault injection.
 *
 * Wraps any port adapter (or any object with async methods) in a Proxy
 * that injects errors, latency, and dropped writes per a configurable
 * profile. Used in integration tests to exercise failure paths against
 * the real domain code.
 *
 * Atlas's hexagonal architecture is the right surface for chaos: every
 * external interaction goes through a port. Wrapping the adapter lets
 * us shake the system from the outside-in without touching domain code.
 *
 * Determinism: pass a `seed` in the profile for reproducible runs. With
 * no seed, `Math.random()` is used.
 */
export type ChaosErrorFactory = (methodName: string, args: readonly unknown[]) => Error;
export interface MethodChaos {
    /** With this probability (0..1), throw / reject before invoking the underlying method. */
    readonly error?: {
        readonly probability: number;
        readonly factory: ChaosErrorFactory;
    };
    /** With this probability, sleep before invoking — uniform within the range. */
    readonly latency?: {
        readonly probability: number;
        readonly minMs: number;
        readonly maxMs: number;
    };
    /**
     * With this probability, silently return without invoking the underlying
     * method. Only applied to write-shaped methods (matched by
     * `ChaosProfile.writeMethodPattern`). Reads are never dropped — that
     * would mask bugs rather than surface them.
     */
    readonly drop?: {
        readonly probability: number;
        /** Value returned in place of the underlying call (default: undefined). */
        readonly returnValue?: unknown;
    };
}
export interface ChaosProfile {
    /** Seed for the deterministic PRNG. Omit for non-deterministic Math.random(). */
    readonly seed?: number;
    /** Per-method overrides — exact method name on the wrapped adapter. */
    readonly methods?: Readonly<Record<string, MethodChaos>>;
    /** Fallback for any method without a per-method entry. */
    readonly defaultMethod?: MethodChaos;
    /**
     * Methods whose name matches this regex are eligible for `drop`.
     * Default: append/set/create/update/delete/put/insert/push/add/emit/upsert.
     */
    readonly writeMethodPattern?: RegExp;
}
const DEFAULT_WRITE_PATTERN = /^(append|set|create|update|delete|put|insert|push|add|emit|upsert|remove|revoke)/i;
/**
 * Mulberry32 — small, fast, well-distributed PRNG. Used when `profile.seed`
 * is provided so chaos runs are reproducible across CI shards.
 */
function makePrng(seed: number | undefined): () => number {
    if (seed === undefined)
        return Math.random;
    let s = seed >>> 0;
    return function (): number {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function chaosFor(profile: ChaosProfile, methodName: string): MethodChaos | undefined {
    return profile.methods?.[methodName] ?? profile.defaultMethod;
}
function isWriteMethod(profile: ChaosProfile, methodName: string): boolean {
    const pattern = profile.writeMethodPattern ?? DEFAULT_WRITE_PATTERN;
    return pattern.test(methodName);
}
function sleep(ms: number): Promise<void> {
    return new Promise(function (resolve) {
        return setTimeout(resolve, ms);
    });
}
export function withChaos<T extends object>(adapter: T, profile: ChaosProfile): T {
    const rng = makePrng(profile.seed);
    return new Proxy(adapter, {
        get(target, prop, receiver) {
            // Boundary: Reflect.get returns `any` by design — the Proxy
            // wraps an unconstrained adapter surface (`T extends object`).
            // We immediately type the read as `unknown` and narrow with a
            // `typeof` guard before any call.
            const value: unknown = Reflect.get(target, prop, receiver);
            // Pass through anything that isn't a function — properties, accessors,
            // symbols (well-known and otherwise).
            if (typeof value !== 'function')
                return value;
            // After `typeof value === 'function'`, `value` is callable. TS
            // narrows it to `Function` — we widen to a typed variadic so
            // `.bind` and `.apply` are callable without any-typing.
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: Proxy wraps untyped adapter methods; runtime callable check above
            const fn = value as (...a: unknown[]) => unknown;
            if (typeof prop === 'symbol')
                return fn.bind(target);
            const methodName = prop;
            const chaos = chaosFor(profile, methodName);
            // No chaos configured for this method — return a bound passthrough.
            if (!chaos)
                return fn.bind(target);
            // Wrapped: error / drop / latency, then call.
            return async function chaosWrapped(this: unknown, ...args: unknown[]): Promise<unknown> {
                // 1. Error injection (highest priority — failure dominates).
                if (chaos.error && rng() < chaos.error.probability) {
                    throw chaos.error.factory(methodName, args);
                }
                // 2. Drop (writes only — silently no-op).
                if (chaos.drop && rng() < chaos.drop.probability && isWriteMethod(profile, methodName)) {
                    return chaos.drop.returnValue;
                }
                // 3. Latency (additive on top of any real latency).
                if (chaos.latency && rng() < chaos.latency.probability) {
                    const span = Math.max(0, chaos.latency.maxMs - chaos.latency.minMs);
                    const ms = chaos.latency.minMs + Math.floor(rng() * (span + 1));
                    if (ms > 0)
                        await sleep(ms);
                }
                // 4. Real call.
                return fn.apply(target, args);
            };
        },
    });
}
