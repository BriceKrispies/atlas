import type { SecretStore } from '@atlas/ports';

/**
 * Boot-time `SecretStore` backed by `process.env`. The whole environment
 * is snapshotted at construction so subsequent `process.env` mutations
 * do not affect lookups (deterministic across the process lifetime).
 *
 * Production deployments swap this for a sealed-secrets / KMS-backed
 * impl with the same surface; the rest of the platform never sees the
 * difference.
 */
export class EnvSecretStore implements SecretStore {
  private readonly snapshot: ReadonlyMap<string, string>;

  constructor(env: Readonly<Record<string, string | undefined>> = process.env) {
    const m = new Map<string, string>();
    for (const [k, v] of Object.entries(env)) {
      if (typeof v === 'string') m.set(k, v);
    }
    this.snapshot = m;
  }

  get(name: string): string | null {
    return this.snapshot.get(name) ?? null;
  }
}
