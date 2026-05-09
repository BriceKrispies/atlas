// Fixture discovery for the spec-validate harness.
//
// Port of `crates/spec_validate/src/discover.rs`. Walks a directory and
// parses fixture filenames according to the convention:
//
//   `<kind>__<expect>__<name>.json`
//
// where `kind` is one of (event_envelope | module_manifest |
// search_documents | analytics_events) and `expect` is `valid` | `invalid`.
//
// `name` is freeform but must NOT contain double underscores.

import { readdir, stat } from 'node:fs/promises';
import { join, basename, extname, sep } from 'node:path';

/** Fixture kind (domain type category). */
export type Kind =
  | 'event_envelope'
  | 'module_manifest'
  | 'search_documents'
  | 'analytics_events';

export const ALL_KINDS: ReadonlyArray<Kind> = [
  'event_envelope',
  'module_manifest',
  'search_documents',
  'analytics_events',
] as const;

/** Expected validation outcome encoded in the filename. */
export type Expect = 'valid' | 'invalid';

/** A discovered test case, ready to load + validate. */
export interface Case {
  kind: Kind;
  expect: Expect;
  name: string;
  /** Absolute path to the fixture file. */
  path: string;
}

/** Display-friendly identifier for a case (matches Rust `Case::id`). */
export function caseId(c: Case): string {
  return `${c.kind}__${c.expect}__${c.name}`;
}

export type ParseResult =
  | { tag: 'ok'; case: Case }
  | { tag: 'not_json'; path: string }
  | { tag: 'no_match'; path: string };

function asKind(s: string): Kind | null {
  switch (s) {
    case 'event_envelope':
    case 'module_manifest':
    case 'search_documents':
    case 'analytics_events':
      return s;
    default:
      return null;
  }
}

function asExpect(s: string): Expect | null {
  if (s === 'valid' || s === 'invalid') return s;
  return null;
}

/**
 * Parse a filename according to the convention.
 *
 * Pure string parsing — does NOT touch the filesystem. The returned `path`
 * is whatever was passed in. Use {@link discover} to walk a directory.
 */
export function parseFilename(path: string): ParseResult {
  // file_stem / extension semantics matching Rust's std::path::Path.
  const file = basename(path);
  const ext = extname(file); // includes the leading dot, e.g. ".json"
  if (ext !== '.json') {
    return { tag: 'not_json', path };
  }
  const stem = file.slice(0, file.length - ext.length);
  if (stem.length === 0) {
    return { tag: 'no_match', path };
  }

  const parts = stem.split('__');
  if (parts.length !== 3) {
    return { tag: 'no_match', path };
  }
  // After confirming length === 3, indexed access is safe but TS still
  // sees `string | undefined` under noUncheckedIndexedAccess.
  const kindStr = parts[0]!;
  const expectStr = parts[1]!;
  const name = parts[2]!;

  const kind = asKind(kindStr);
  if (kind === null) return { tag: 'no_match', path };
  const expect = asExpect(expectStr);
  if (expect === null) return { tag: 'no_match', path };
  if (name.length === 0) return { tag: 'no_match', path };
  // After splitting on `__`, no part can contain `__`; guard kept for
  // parity with the Rust check.
  if (name.includes('__')) return { tag: 'no_match', path };

  return { tag: 'ok', case: { kind, expect, name, path } };
}

export interface DiscoveryResult {
  cases: Case[];
  /** `.json` files that didn't match the naming convention. */
  ignored: string[];
}

/**
 * Minimal structural shape of `@atlas/logging`'s Logger that we need —
 * just `debug`/`warn`. Kept structural so this module doesn't pull
 * `@atlas/logging` as a hard dependency; callers thread their
 * `ctx.logger` directly.
 */
export interface DiscoverLogger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
}

export interface DiscoverOptions {
  /** Optional structured logger for filesystem read failures. */
  logger?: DiscoverLogger;
}

/** Recursively walk `fixturesDir` and return parsed cases sorted stably. */
export async function discover(
  fixturesDir: string,
  options: DiscoverOptions = {},
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = { cases: [], ignored: [] };
  await walk(fixturesDir, result, options.logger);
  result.cases.sort(compareCase);
  return result;
}

async function walk(
  dir: string,
  out: DiscoveryResult,
  logger?: DiscoverLogger,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    // Mirror Rust: skip non-dirs without failing the harness, but emit
    // a structured debug record so downstream operators can see why a
    // path returned no cases instead of staring at silence.
    logger?.debug('spec-validate.discover: readdir failed', {
      dir,
      error: (err as Error)?.message ?? String(err),
    });
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s;
    try {
      s = await stat(full);
    } catch (err) {
      logger?.debug('spec-validate.discover: stat failed', {
        path: full,
        error: (err as Error)?.message ?? String(err),
      });
      continue;
    }
    if (s.isDirectory()) {
      await walk(full, out, logger);
      continue;
    }
    const parsed = parseFilename(full);
    switch (parsed.tag) {
      case 'ok':
        out.cases.push(parsed.case);
        break;
      case 'no_match':
        // Only track .json files in the ignored list (matches Rust).
        if (extname(parsed.path) === '.json') out.ignored.push(parsed.path);
        break;
      case 'not_json':
        // Silently ignored.
        break;
    }
  }
}

function compareCase(a: Case, b: Case): number {
  const k = compareKind(a.kind, b.kind);
  if (k !== 0) return k;
  const e = compareExpect(a.expect, b.expect);
  if (e !== 0) return e;
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

function compareKind(a: Kind, b: Kind): number {
  const ai = ALL_KINDS.indexOf(a);
  const bi = ALL_KINDS.indexOf(b);
  return ai - bi;
}

function compareExpect(a: Expect, b: Expect): number {
  if (a === b) return 0;
  return a === 'valid' ? -1 : 1;
}

// `sep` re-export keeps the import surface minimal — consumers that just
// want to construct fixture paths can import { join } from 'node:path'.
void sep;
