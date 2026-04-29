import { describe, test, expect, beforeEach } from 'vitest';
import type { RenderTreeStore } from '@atlas/ports';

/**
 * Port-parity contract for `RenderTreeStore`. Every adapter
 * (`PostgresRenderTreeStore`, `IdbRenderTreeStore`) MUST satisfy this
 * suite — render trees stored via the Rust adapter and read back via
 * either TS adapter must round-trip byte-equivalent.
 */
export function renderTreeStoreContract(makeStore: () => Promise<RenderTreeStore>): void {
  describe('RenderTreeStore contract', () => {
    let store: RenderTreeStore;
    beforeEach(async () => {
      store = await makeStore();
    });

    test('read returns null for a missing (tenant, page)', async () => {
      const v = await store.read('t1', 'page-absent');
      expect(v).toBeNull();
    });

    test('write then read round-trips a render tree', async () => {
      const tree = {
        version: 1,
        nodes: [
          {
            type: 'heading',
            props: { level: 1 },
            children: [{ type: 'text', props: { content: 'Hello' } }],
          },
        ],
      };
      await store.write('t1', 'welcome', tree);
      const got = await store.read('t1', 'welcome');
      expect(got).toEqual(tree);
    });

    test('write with the same (tenant, page) overwrites', async () => {
      const a = { version: 1, nodes: [{ type: 'p' }] };
      const b = { version: 1, nodes: [{ type: 'h1' }] };
      await store.write('t1', 'home', a);
      await store.write('t1', 'home', b);
      expect(await store.read('t1', 'home')).toEqual(b);
    });

    test('tenant scope: same pageId across tenants is isolated', async () => {
      const a = { version: 1, nodes: [{ type: 'a' }] };
      const b = { version: 1, nodes: [{ type: 'b' }] };
      await store.write('t1', 'shared', a);
      await store.write('t2', 'shared', b);
      expect(await store.read('t1', 'shared')).toEqual(a);
      expect(await store.read('t2', 'shared')).toEqual(b);
    });

    test('delete removes the record; subsequent read is null', async () => {
      await store.write('t1', 'gone', { version: 1, nodes: [{ type: 'p' }] });
      await store.delete('t1', 'gone');
      expect(await store.read('t1', 'gone')).toBeNull();
    });

    test('delete on a missing (tenant, page) is a silent no-op', async () => {
      await expect(store.delete('t1', 'never-existed')).resolves.toBeUndefined();
    });

    test('handles a deeply nested tree', async () => {
      const tree = {
        version: 1,
        nodes: [
          {
            type: 'section',
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'text', props: { content: 'one' } },
                  { type: 'text', props: { content: 'two' } },
                ],
              },
            ],
          },
        ],
      };
      await store.write('t1', 'deep', tree);
      expect(await store.read('t1', 'deep')).toEqual(tree);
    });
  });
}
