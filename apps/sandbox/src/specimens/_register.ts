import { AtlasSandbox, type Specimen } from '../sandbox-app.ts';

/**
 * Convenience wrapper around `AtlasSandbox.register`. Every specimen file
 * imports this and calls `S({...})` at module-top-level; the barrel in
 * `./index.ts` imports each file for its side effect.
 */
export const S = (spec: Specimen): void => AtlasSandbox.register(spec);
