import { describe, test, expect, beforeEach } from '@atlas/test';
import type { SecretStore } from '@atlas/ports';
/**
 * Contract any `SecretStore` adapter must satisfy. Both
 * `EnvSecretStore` (`@atlas/adapter-node`) and `InMemorySecretStore`
 * (`@atlas/adapter-idb`) run this suite.
 *
 * The factory takes the seed values so the runner can construct the
 * adapter however it likes (env injection for Node, constructor map
 * for IDB) without leaking adapter specifics into the contract.
 */
export function secretStoreContract(
  makeStore: (seed: Readonly<Record<string, string>>) => Promise<SecretStore>,
): void {
  describe('SecretStore contract', function () {
    let store: SecretStore;
    beforeEach(async function () {
      store = await makeStore({
        IDENTITY_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        SOME_SECRET: 'plain-value',
        EMPTY_VALUE: '',
      });
    });
    test('returns the seeded value for a known name', function () {
      expect(store.get('IDENTITY_ENCRYPTION_KEY')).toBe(
        'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      );
      expect(store.get('SOME_SECRET')).toBe('plain-value');
    });
    test('returns null for an absent name', function () {
      expect(store.get('NEVER_SET')).toBeNull();
    });
    test('preserves the empty string as a present-but-empty value', function () {
      expect(store.get('EMPTY_VALUE')).toBe('');
    });
    test('lookups are case-sensitive', function () {
      expect(store.get('identity_encryption_key')).toBeNull();
      expect(store.get('IDENTITY_ENCRYPTION_KEY')).not.toBeNull();
    });
    test('repeated lookups return the same value (snapshot semantics)', function () {
      const a = store.get('SOME_SECRET');
      const b = store.get('SOME_SECRET');
      expect(a).toBe(b);
    });
  });
}
