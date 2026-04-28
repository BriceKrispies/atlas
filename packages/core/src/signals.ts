/**
 * Fine-grained reactive signals.
 *
 * signal()   — writable reactive value
 * computed() — derived value that auto-updates when dependencies change
 * effect()   — side effect that re-runs when dependencies change
 */

type EffectFn = () => void;

let activeEffect: EffectFn | null = null;
let pendingEffects: EffectFn[] = [];
let batchDepth = 0;

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
  } finally {
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
        subscribers.add(activeEffect);
      }
      return value;
    },
    set(newValue: T) {
      if (Object.is(value, newValue)) return;
      value = newValue;
      for (const sub of subscribers) {
        if (batchDepth > 0) {
          pendingEffects.push(sub);
        } else {
          sub();
        }
      }
    },
    subscribe(fn: (v: T) => void) {
      fn(value);
      const effectFn: EffectFn = () => fn(value);
      subscribers.add(effectFn);
      return () => {
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

  const recompute = (): void => {
    const prev = activeEffect;
    activeEffect = markDirty;
    try {
      const newValue = fn();
      if (!Object.is(value, newValue)) {
        value = newValue;
        for (const sub of subscribers) {
          if (batchDepth > 0) {
            pendingEffects.push(sub);
          } else {
            sub();
          }
        }
      }
      dirty = false;
    } finally {
      activeEffect = prev;
    }
  };

  const markDirty = (): void => {
    if (!dirty) {
      dirty = true;
      recompute();
    }
  };

  return {
    get value() {
      if (activeEffect) {
        subscribers.add(activeEffect);
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

  const run: EffectFn = () => {
    if (typeof cleanup === 'function') {
      cleanup();
    }
    const prev = activeEffect;
    activeEffect = run;
    try {
      cleanup = fn();
    } finally {
      activeEffect = prev;
    }
  };

  run();

  return () => {
    if (typeof cleanup === 'function') {
      cleanup();
    }
  };
}
