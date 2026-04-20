/**
 * Fine-grained reactive signals.
 *
 * signal()   — writable reactive value
 * computed() — derived value that auto-updates when dependencies change
 * effect()   — side effect that re-runs when dependencies change
 */

/** @type {(() => void) | null} */
let activeEffect = null;

/** @type {(() => void)[]} */
let pendingEffects = [];
let batchDepth = 0;

/**
 * Batch multiple signal writes so effects only run once.
 * @param {() => void} fn
 */
export function batch(fn) {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      const effects = [...new Set(pendingEffects)];
      pendingEffects = [];
      for (const effect of effects) {
        effect();
      }
    }
  }
}

/**
 * Create a writable signal.
 * @template T
 * @param {T} initialValue
 * @returns {{ value: T, set: (v: T) => void, subscribe: (fn: (v: T) => void) => () => void }}
 */
export function signal(initialValue) {
  let value = initialValue;
  /** @type {Set<() => void>} */
  const subscribers = new Set();

  const sig = {
    get value() {
      if (activeEffect) {
        subscribers.add(activeEffect);
      }
      return value;
    },
    set(newValue) {
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
    subscribe(fn) {
      // Run immediately with current value, then on changes
      fn(value);
      const effectFn = () => fn(value);
      subscribers.add(effectFn);
      return () => subscribers.delete(effectFn);
    },
  };

  return sig;
}

/**
 * Create a derived signal that auto-updates when dependencies change.
 * @template T
 * @param {() => T} fn
 * @returns {{ value: T }}
 */
export function computed(fn) {
  let value;
  let dirty = true;
  /** @type {Set<() => void>} */
  const subscribers = new Set();

  const recompute = () => {
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

  const markDirty = () => {
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
      return value;
    },
  };
}

/**
 * Create a side effect that re-runs when its signal dependencies change.
 * Returns a dispose function.
 * @param {() => void | (() => void)} fn — may return a cleanup function
 * @returns {() => void} dispose
 */
export function effect(fn) {
  let cleanup;

  const run = () => {
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
