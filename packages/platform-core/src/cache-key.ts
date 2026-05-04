/**
 * Deterministic cache-key derivation and tag rendering.
 *
 * TS counterpart of `crates/core/src/cache.rs`. The on-the-wire output
 * (the cache-key string and rendered tag strings) MUST be byte-identical
 * to the Rust implementation so that ingress and Node ingress can reuse
 * the same cache entries (Invariants I9 + I10).
 *
 * Key format: `cache:{artifactId}@v{ttlSeconds}:{...keyParts}:{varyHash}`
 *
 * - keyParts come from each tag template (in declared order). For each
 *   tag template the FIRST placeholder is extracted (Rust uses the
 *   first '{' and the first '}'), and the value from `keyValues` is
 *   appended. If a placeholder has no value the part is silently
 *   skipped — but `validateCacheKeyInputs` runs first and errors when
 *   any tag-template placeholder is missing from both maps.
 * - varyHash is appended only when `varyValues` is provided AND non-empty.
 *   Dimensions are formatted via Rust's `format!("{:?}", dim)` then
 *   `.to_lowercase()` — which yields "tenant" / "locale" / "role" / "user".
 *   Dimensions are sorted into a BTreeMap (alphabetical) and rendered as
 *   `vary(k1=v1,k2=v2)`. If no dimension has a runtime value we emit
 *   the literal `none`.
 */

import type { CacheArtifact, VaryDimension } from './manifest.ts';

/**
 * Lower-case key used by `varyValues` lookups and the rendered vary hash.
 * Mirrors Rust's `format!("{:?}", dim).to_lowercase()`.
 */
function dimensionKey(dim: VaryDimension): string {
  switch (dim) {
    case 'TENANT':
      return 'tenant';
    case 'LOCALE':
      return 'locale';
    case 'ROLE':
      return 'role';
    case 'USER':
      return 'user';
  }
}

/**
 * Cache-error taxonomy. Mirrors `CacheError` in `crates/core/src/cache.rs`.
 */
export type CacheErrorKind =
  | 'MissingRequiredKeyPart'
  | 'MissingPlaceholder'
  | 'InvalidPrivacyConfiguration'
  | 'InvalidTagTemplate';

export interface CacheErrorDetail {
  /** For MissingRequiredKeyPart / MissingPlaceholder. */
  placeholder?: string;
  /** For MissingPlaceholder. */
  tagTemplate?: string;
  /** Free-form for InvalidPrivacyConfiguration / InvalidTagTemplate. */
  description?: string;
}

/**
 * CacheError — thrown by `buildCacheKey`, `renderTags`,
 * `validateCacheArtifact`, and `validateCacheKeyInputs`. Carries an
 * `invariant` tag (`I9`) for the cache-key paths since these directly
 * enforce Invariants I9 (tenantId in cache key) and I10 (tag-based
 * invalidation).
 */
export class CacheError extends Error {
  readonly kind: CacheErrorKind;
  readonly detail: CacheErrorDetail;
  readonly invariant: 'I9' | 'I10' | undefined;

  constructor(
    kind: CacheErrorKind,
    detail: CacheErrorDetail,
    invariant?: 'I9' | 'I10',
  ) {
    super(formatCacheErrorMessage(kind, detail));
    this.name = 'CacheError';
    this.kind = kind;
    this.detail = detail;
    this.invariant = invariant;
  }
}

function formatCacheErrorMessage(
  kind: CacheErrorKind,
  detail: CacheErrorDetail,
): string {
  switch (kind) {
    case 'MissingRequiredKeyPart':
      return `Missing required key part: ${detail.placeholder ?? ''}`;
    case 'MissingPlaceholder':
      return `Missing placeholder '${detail.placeholder ?? ''}' in tag template '${detail.tagTemplate ?? ''}'`;
    case 'InvalidPrivacyConfiguration':
      return `Invalid privacy configuration: ${detail.description ?? ''}`;
    case 'InvalidTagTemplate':
      return `Invalid tag template: ${detail.description ?? ''}`;
  }
}

/**
 * Build a deterministic cache key from an artifact descriptor and runtime
 * values. Validates inputs first and throws CacheError on missing parts.
 *
 * Format: `cache:{artifactId}@v{ttlSeconds}:{...keyParts}[:{varyHash}]`.
 */
export function buildCacheKey(
  artifact: CacheArtifact,
  keyValues: Readonly<Record<string, string>>,
  varyValues?: Readonly<Record<string, string>>,
): string {
  validateCacheKeyInputs(artifact, keyValues, varyValues);

  const parts: string[] = [];
  parts.push('cache');
  parts.push(`${artifact.artifactId}@v${artifact.ttlSeconds}`);

  // Build stable key parts using tags as the ordered template. Each tag's
  // first placeholder selects the value to append.
  for (const tagTemplate of artifact.tags) {
    const keyName = extractPlaceholder(tagTemplate);
    if (keyName !== undefined) {
      const value = keyValues[keyName];
      if (value !== undefined) {
        parts.push(value);
      }
    }
  }

  if (varyValues !== undefined && Object.keys(varyValues).length > 0) {
    const varyHash = buildVaryHash(artifact.varyBy, varyValues);
    parts.push(varyHash);
  }

  return parts.join(':');
}

/**
 * Build the vary hash from a list of dimensions plus runtime values.
 *
 * Sorts dimensions alphabetically (BTreeMap in Rust) and renders as
 * `vary(k1=v1,k2=v2)`. If no dimension has a runtime value, returns
 * the literal `none` (matches Rust).
 */
function buildVaryHash(
  varyBy: ReadonlyArray<VaryDimension>,
  varyValues: Readonly<Record<string, string>>,
): string {
  const sorted = new Map<string, string>();

  for (const dim of varyBy) {
    const key = dimensionKey(dim);
    const value = varyValues[key];
    if (value !== undefined) {
      sorted.set(key, value);
    }
  }

  if (sorted.size === 0) {
    return 'none';
  }

  const repr: string[] = [];
  // Sort by key alphabetically — mirrors Rust's BTreeMap iteration order.
  const sortedKeys = Array.from(sorted.keys()).sort();
  for (const k of sortedKeys) {
    repr.push(`${k}=${sorted.get(k)!}`);
  }

  return `vary(${repr.join(',')})`;
}

/**
 * Render every tag template in the artifact by substituting placeholders
 * with values from `keyValues` (preferred) or `varyValues` (fallback).
 * Throws CacheError when a placeholder has no value in either map.
 */
export function renderTags(
  artifact: CacheArtifact,
  keyValues: Readonly<Record<string, string>>,
  varyValues?: Readonly<Record<string, string>>,
): string[] {
  const out: string[] = [];
  for (const tag of artifact.tags) {
    out.push(renderTagTemplate(tag, keyValues, varyValues));
  }
  return out;
}

function renderTagTemplate(
  template: string,
  keyValues: Readonly<Record<string, string>>,
  varyValues: Readonly<Record<string, string>> | undefined,
): string {
  let result = template;
  const placeholders = extractAllPlaceholders(template);
  for (const placeholder of placeholders) {
    const replacement =
      keyValues[placeholder] ??
      (varyValues !== undefined ? varyValues[placeholder] : undefined);
    if (replacement === undefined) {
      throw new CacheError(
        'MissingPlaceholder',
        { placeholder, tagTemplate: template },
        'I10',
      );
    }
    // Replace ALL occurrences (Rust's String::replace replaces all).
    result = result.split(`{${placeholder}}`).join(replacement);
  }
  return result;
}

/**
 * Extract the FIRST placeholder name from a tag template. Mirrors
 * Rust's `template.find('{')` + `template.find('}')` behaviour:
 * uses the earliest '{' and the earliest '}'. Returns undefined when
 * either delimiter is missing or '}' precedes/equals '{'.
 */
export function extractPlaceholder(template: string): string | undefined {
  const start = template.indexOf('{');
  if (start < 0) return undefined;
  const end = template.indexOf('}');
  if (end < 0) return undefined;
  if (end > start) {
    return template.slice(start + 1, end);
  }
  return undefined;
}

/**
 * Extract every placeholder name from a template, in order. Mirrors
 * Rust's char-by-char state machine: empty `{}` blocks are skipped,
 * unclosed `{` is silently dropped, stray `}` resets the state.
 */
export function extractAllPlaceholders(template: string): string[] {
  const out: string[] = [];
  let current = '';
  let inside = false;

  for (const ch of template) {
    if (ch === '{') {
      inside = true;
      current = '';
    } else if (ch === '}') {
      if (inside && current.length > 0) {
        out.push(current);
      }
      inside = false;
    } else if (inside) {
      current += ch;
    }
  }

  return out;
}

/**
 * Validate cache-artifact configuration at registration time:
 * - tenantId MUST appear in tags unless privacy is PUBLIC (Invariant I9)
 * - principalId MUST appear in varyBy when privacy is USER
 * - tag templates MUST have balanced braces
 */
export function validateCacheArtifact(artifact: CacheArtifact): void {
  if (artifact.privacy !== 'PUBLIC') {
    const hasTenantTag = artifact.tags.some(
      (tag) => tag.includes('{tenantId}') || tag.includes('{tenant_id}'),
    );
    if (!hasTenantTag) {
      throw new CacheError(
        'InvalidPrivacyConfiguration',
        {
          description:
            'tenantId must be in tag templates unless privacy is PUBLIC',
        },
        'I9',
      );
    }
  }

  if (artifact.privacy === 'USER') {
    const hasUser = artifact.varyBy.some((dim) => dim === 'USER');
    if (!hasUser) {
      throw new CacheError('InvalidPrivacyConfiguration', {
        description: 'principalId must be in varyBy when privacy is USER',
      });
    }
  }

  for (const tag of artifact.tags) {
    if (tag.includes('{') && !tag.includes('}')) {
      throw new CacheError('InvalidTagTemplate', {
        description: `Unclosed placeholder in tag: ${tag}`,
      });
    }
  }
}

/**
 * Validate that every placeholder referenced by a tag template has
 * a runtime value in either keyValues or varyValues. Throws CacheError
 * with kind `MissingRequiredKeyPart` on the first missing placeholder.
 */
export function validateCacheKeyInputs(
  artifact: CacheArtifact,
  keyValues: Readonly<Record<string, string>>,
  varyValues?: Readonly<Record<string, string>>,
): void {
  for (const tag of artifact.tags) {
    const placeholders = extractAllPlaceholders(tag);
    for (const placeholder of placeholders) {
      const found =
        Object.prototype.hasOwnProperty.call(keyValues, placeholder) ||
        (varyValues !== undefined &&
          Object.prototype.hasOwnProperty.call(varyValues, placeholder));
      if (!found) {
        throw new CacheError(
          'MissingRequiredKeyPart',
          { placeholder },
          'I9',
        );
      }
    }
  }
}
