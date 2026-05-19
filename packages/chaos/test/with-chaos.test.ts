import { describe, expect, it } from '@atlas/test';
import { profiles, withChaos, type ChaosProfile } from '../src/index.ts';
interface FakeStore {
    append(value: string): Promise<string>;
    read(key: string): Promise<string | null>;
}
function makeFakeStore(): FakeStore {
    const data = new Map<string, string>();
    let appendCount = 0;
    const store: FakeStore & {
        __appends(): number;
    } = {
        async append(value: string): Promise<string> {
            appendCount++;
            const id = `id-${appendCount}`;
            data.set(id, value);
            return id;
        },
        async read(key: string): Promise<string | null> {
            return data.get(key) ?? null;
        },
        __appends(): number {
            return appendCount;
        },
    };
    return store;
}
describe('withChaos', function () {
    it('passes through method calls when no chaos is configured', async function () {
        const store = makeFakeStore();
        const wrapped = withChaos(store, profiles.NONE);
        const id = await wrapped.append('hello');
        expect(id).toBe('id-1');
        expect(await wrapped.read(id)).toBe('hello');
    });
    it('injects errors at the configured rate (deterministic via seed)', async function () {
        const store = makeFakeStore();
        const profile: ChaosProfile = {
            seed: 42,
            defaultMethod: {
                error: {
                    probability: 1,
                    factory: function (method): Error {
                        return new Error(`forced error in ${method}`);
                    },
                },
            },
        };
        const wrapped = withChaos(store, profile);
        await expect(wrapped.append('hi')).rejects.toThrow('forced error in append');
        await expect(wrapped.read('id-1')).rejects.toThrow('forced error in read');
    });
    it('drops writes (and only writes) when configured', async function () {
        const store = makeFakeStore();
        const profile: ChaosProfile = {
            seed: 1,
            defaultMethod: { drop: { probability: 1 } },
        };
        const wrapped = withChaos(store, profile);
        // Write is dropped — store sees no append, return is undefined.
        const id = await wrapped.append('lost');
        expect(id).toBeUndefined();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, atlas-widgets/no-double-cast -- boundary: makeFakeStore returns FakeStore but adds the test-only __appends() hook; the wrapper erases that detail
        expect((store as unknown as {
            __appends(): number;
        }).__appends()).toBe(0);
        // Read is NOT eligible for drop, even at probability 1.
        expect(await wrapped.read('id-1')).toBeNull();
    });
    it('adds latency at the configured probability', async function () {
        const store = makeFakeStore();
        const profile: ChaosProfile = {
            seed: 7,
            defaultMethod: {
                latency: { probability: 1, minMs: 30, maxMs: 30 },
            },
        };
        const wrapped = withChaos(store, profile);
        const t0 = Date.now();
        await wrapped.append('slow');
        const elapsed = Date.now() - t0;
        expect(elapsed).toBeGreaterThanOrEqual(25);
    });
    it('per-method override beats default', async function () {
        const store = makeFakeStore();
        const profile: ChaosProfile = {
            seed: 99,
            methods: {
                append: {
                    error: {
                        probability: 1,
                        factory: function (): Error {
                            return new Error('append-only failure');
                        },
                    },
                },
            },
            defaultMethod: {
                error: {
                    probability: 0,
                    factory: function (): Error {
                        return new Error('default');
                    },
                },
            },
        };
        const wrapped = withChaos(store, profile);
        await expect(wrapped.append('x')).rejects.toThrow('append-only failure');
        expect(await wrapped.read('nonexistent')).toBeNull();
    });
    it('is deterministic across runs with the same seed', async function () {
        const profile: ChaosProfile = {
            seed: 12345,
            defaultMethod: {
                error: {
                    probability: 0.5,
                    factory: function (): Error {
                        return new Error('boom');
                    },
                },
            },
        };
        const run = async function (): Promise<boolean[]> {
            const wrapped = withChaos(makeFakeStore(), profile);
            const results: boolean[] = [];
            for (let i = 0; i < 20; i++) {
                try {
                    await wrapped.append(`v${i}`);
                    results.push(false);
                }
                catch {
                    results.push(true);
                }
            }
            return results;
        };
        const a = await run();
        const b = await run();
        expect(a).toEqual(b);
    });
});
