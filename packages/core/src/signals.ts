/**
 * Fine-grained reactive signals.
 *
 * signal()   — writable reactive value
 * computed() — derived value that auto-updates when dependencies change
 * effect()   — side effect that re-runs when dependencies change
 */
type EffectFn = () => void;
// Each EffectFn carries the set of subscriber-Sets it has been added to.
// Without this, dispose() can't unsubscribe from signals it read — they keep
// strong refs to the effect's run closure and re-fire it forever (memory leak,
// stale renders against detached DOM).
type TrackedEffect = EffectFn & {
    deps?: Set<Set<EffectFn>>;
};
let activeEffect: TrackedEffect | null = null;
let pendingEffects: EffectFn[] = [];
let batchDepth = 0;
/** Add `effect` to `subs` and record the link so the effect can clear it later. */
function track(subs: Set<EffectFn>, effect: TrackedEffect): void {
    subs.add(effect);
    (effect.deps ??= new Set()).add(subs);
}
/** Remove `effect` from every subscriber-Set it was tracking. */
function clearDeps(effect: TrackedEffect): void {
    const deps = effect.deps;
    if (!deps)
        return;
    for (const subs of deps)
        subs.delete(effect);
    deps.clear();
}
export interface Signal<T> {
    readonly value: T;
    set(v: T): void;
    subscribe(fn: (v: T) => void): () => void;
}
export interface Computed<T> {
    readonly value: T;
}
export type EffectCleanup = () => void;
export type EffectCallback = () => void | EffectCleanup;
/**
 * Batch multiple signal writes so effects only run once.
 */
export function batch(fn: () => void): void {
    batchDepth++;
    try {
        fn();
    }
    finally {
        batchDepth--;
        if (batchDepth === 0) {
            const effects = [...new Set(pendingEffects)];
            pendingEffects = [];
            for (const eff of effects) {
                eff();
            }
        }
    }
}
/**
 * Create a writable signal.
 */
export function signal<T>(initialValue: T): Signal<T> {
    let value = initialValue;
    const subscribers = new Set<EffectFn>();
    return {
        get value() {
            if (activeEffect) {
                track(subscribers, activeEffect);
            }
            return value;
        },
        set(newValue: T) {
            if (Object.is(value, newValue))
                return;
            value = newValue;
            // Snapshot: subscriber.run() does clearDeps + retracks itself, which
            // mutates `subscribers` mid-iteration and re-yields the same entry on
            // V8 Sets — infinite loop without the copy.
            for (const sub of [...subscribers]) {
                if (batchDepth > 0) {
                    pendingEffects.push(sub);
                }
                else {
                    sub();
                }
            }
        },
        subscribe(fn: (v: T) => void) {
            fn(value);
            const effectFn: EffectFn = function () {
                return fn(value);
            };
            subscribers.add(effectFn);
            return function () {
                subscribers.delete(effectFn);
            };
        },
    };
}
/**
 * Create a derived signal that auto-updates when dependencies change.
 */
export function computed<T>(fn: () => T): Computed<T> {
    let value: T;
    let dirty = true;
    const subscribers = new Set<EffectFn>();
    const markDirty: TrackedEffect = function () {
        if (!dirty) {
            dirty = true;
            recompute();
        }
    };
    const recompute = function (): void {
        clearDeps(markDirty);
        const prev = activeEffect;
        activeEffect = markDirty;
        try {
            const newValue = fn();
            if (!Object.is(value, newValue)) {
                value = newValue;
                for (const sub of [...subscribers]) {
                    if (batchDepth > 0) {
                        pendingEffects.push(sub);
                    }
                    else {
                        sub();
                    }
                }
            }
            dirty = false;
        }
        finally {
            activeEffect = prev;
        }
    };
    return {
        get value() {
            if (activeEffect) {
                track(subscribers, activeEffect);
            }
            if (dirty) {
                recompute();
            }
            return value as T;
        },
    };
}
/**
 * Create a side effect that re-runs when its signal dependencies change.
 * Returns a dispose function.
 */
export function effect(fn: EffectCallback): EffectCleanup {
    let cleanup: EffectCleanup | void;
    let disposed = false;
    const run: TrackedEffect = function () {
        if (disposed)
            return;
        if (typeof cleanup === 'function') {
            cleanup();
        }
        clearDeps(run);
        const prev = activeEffect;
        activeEffect = run;
        try {
            cleanup = fn();
        }
        finally {
            activeEffect = prev;
        }
    };
    run();
    return function () {
        if (disposed)
            return;
        disposed = true;
        clearDeps(run);
        if (typeof cleanup === 'function') {
            cleanup();
        }
    };
}
