import type { SecretStore } from '@atlas/ports';

/**
 * In-memory `SecretStore` for browser sim and tests. Seeded at
 * construction with a snapshot of `name -> value`; lookups are
 * O(1) and never touch disk or `process.env`.
 *
 * Production-equivalent of `EnvSecretStore` from `@atlas/adapter-node`,
 * scoped to environments where `process.env` is unavailable
 * (browser sim) or undesirable (deterministic tests).
 */
export class InMemorySecretStore implements SecretStore {
  private readonly snapshot: ReadonlyMap<string, string>;

  constructor(values: Readonly<Record<string, string>> = {}) {
    this.snapshot = new Map(Object.entries(values));
  }

  get(name: string): string | null {
    return this.snapshot.get(name) ?? null;
  }
}
