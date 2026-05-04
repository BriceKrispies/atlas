/**
 * Upcaster pipeline.
 *
 * An entity row stored at schema_version N is read by the application
 * code that expects schema_version M ≥ N. The upcaster registry knows
 * how to walk a row from N → N+1 → … → M by composing per-step
 * transforms. Reads always upcast; writes always go in at the latest
 * registered version.
 *
 * This pipeline is the L3 platform's answer to "we changed a field's
 * shape." Instead of writing a migration that mutates every row, you
 * register an upcaster from N → N+1 and old rows get upcast lazily on
 * next read. A compaction job (Phase A.5+) optionally rewrites old
 * rows to the latest version on a schedule, but lazy is the default.
 *
 * See `~/.claude/plans/yes-mossy-galaxy.md` for the role this plays.
 */

/**
 * One step of the chain. Takes an opaque attrs payload at version
 * `fromVersion` and returns the same payload at `fromVersion + 1`.
 *
 * Steps must be **pure** and **deterministic**: same input → same output.
 * They are called many times across many rows; side effects break
 * everything.
 */
export type Upcaster = (attrs: unknown) => unknown;

/**
 * Registry of per-step upcasters keyed by `(entityType, fromVersion)`.
 *
 * To go from v1 → v3 the pipeline calls `(entityType, 1)` then
 * `(entityType, 2)`. Missing steps in the middle are an error
 * (`applyUpcasters` throws); registering a step at version N+1 without
 * N below it is a misconfiguration that should fail loud.
 */
export class UpcasterRegistry {
  private readonly chain = new Map<string, Upcaster>();
  private readonly latest = new Map<string, number>();

  private key(entityType: string, fromVersion: number): string {
    return `${entityType}@${fromVersion}`;
  }

  /**
   * Register a single step `fromVersion → fromVersion + 1`. Idempotent
   * if the same function reference is registered twice; throws if a
   * different upcaster collides on the same key.
   */
  register(
    entityType: string,
    fromVersion: number,
    upcaster: Upcaster,
  ): void {
    const k = this.key(entityType, fromVersion);
    const existing = this.chain.get(k);
    if (existing && existing !== upcaster) {
      throw new Error(
        `upcaster collision for ${k}: a different function was already registered`,
      );
    }
    this.chain.set(k, upcaster);
    const target = fromVersion + 1;
    const cur = this.latest.get(entityType) ?? 0;
    if (target > cur) this.latest.set(entityType, target);
  }

  /**
   * The latest version the registry knows how to produce for an entity
   * type. Defaults to 1 when no upcasters are registered (everyone is
   * at v1). Writes use this value when callers don't override.
   */
  latestVersion(entityType: string): number {
    return this.latest.get(entityType) ?? 1;
  }

  /**
   * Walk `attrs` from `fromVersion` up to `toVersion`, applying each
   * registered step in order. Throws when a step is missing.
   */
  apply(
    entityType: string,
    fromVersion: number,
    toVersion: number,
    attrs: unknown,
  ): unknown {
    if (fromVersion > toVersion) {
      throw new Error(
        `cannot downgrade ${entityType} from v${fromVersion} to v${toVersion} — upcasters are forward-only`,
      );
    }
    let v = fromVersion;
    let value = attrs;
    while (v < toVersion) {
      const step = this.chain.get(this.key(entityType, v));
      if (!step) {
        throw new Error(
          `missing upcaster for ${entityType} v${v} → v${v + 1}`,
        );
      }
      value = step(value);
      v += 1;
    }
    return value;
  }
}

/**
 * Convenience: apply the registry's full chain to a row read from the
 * store. Returns the row's attrs at the registry's latest version.
 *
 * Most callers don't use this directly — the read-side wrapper in
 * each module's query layer applies it after `EntityStore.get`. Tests
 * and migration scripts may call it directly.
 */
export function upcastToLatest(
  registry: UpcasterRegistry,
  entityType: string,
  schemaVersion: number,
  attrs: unknown,
): { schemaVersion: number; attrs: unknown } {
  const target = registry.latestVersion(entityType);
  if (schemaVersion >= target) return { schemaVersion, attrs };
  return {
    schemaVersion: target,
    attrs: registry.apply(entityType, schemaVersion, target, attrs),
  };
}
