// JSON loading + doc-field stripping for the spec-validate harness.
//
// Port of `crates/spec_validate/src/json.rs`.

import { readFile } from 'node:fs/promises';

/** Errors raised while loading or parsing a fixture JSON file. */
export class JsonLoadError extends Error {
  override readonly name = 'JsonLoadError';
  readonly path: string;
  override readonly cause: unknown;
  constructor(path: string, message: string, cause: unknown) {
    super(message);
    this.path = path;
    this.cause = cause;
  }
}

/** Read `path` and parse as JSON. */
export async function load(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    throw new JsonLoadError(path, `Failed to read '${path}': ${(e as Error).message}`, e);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new JsonLoadError(
      path,
      `Failed to parse JSON '${path}': ${(e as Error).message}`,
      e,
    );
  }
}

/**
 * Recursively strip documentation fields (keys prefixed with `$`) from a
 * JSON value. Used to drop `$schema`, `$comment`, `$invariants` etc. from
 * fixtures before validation.
 *
 * Walks objects (drops `$`-prefixed keys, recurses into remaining values)
 * and arrays (recurses into each element). Primitives pass through
 * unchanged. Dollar signs in *values* are preserved.
 */
export function stripDocFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripDocFields);
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.startsWith('$')) continue;
      out[k] = stripDocFields(v);
    }
    return out;
  }
  return value;
}

/** Convenience: load + strip doc fields in one shot. */
export async function loadAndStrip(path: string): Promise<unknown> {
  const raw = await load(path);
  return stripDocFields(raw);
}
