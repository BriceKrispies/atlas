import { describe, it, expect } from 'vitest';
import { queryDataSource } from '../src/data-source/query-data-source.ts';
import type { BackendLike } from '../src/data-source/query-data-source.ts';
import type { RowPatch } from '../src/data-source/types.ts';

interface FakeBackendResult {
  backend: BackendLike;
  subs: Array<{ eventType: string; cb: (e: unknown) => void }>;
  emit: (eventType: string, data: unknown) => void;
}

function fakeBackend(
  { response, subscribe = true }: { response?: unknown; subscribe?: boolean } = {},
): FakeBackendResult {
  const subs: Array<{ eventType: string; cb: (e: unknown) => void }> = [];
  const backend: BackendLike = {
    async query(path: string): Promise<unknown> {
      return typeof response === 'function' ? (response as (p: string) => unknown)(path) : response;
    },
  };
  if (subscribe) {
    backend.subscribe = (eventType: string, cb: (e: unknown) => void) => {
      const entry = { eventType, cb };
      subs.push(entry);
      return () => {
        const i = subs.indexOf(entry);
        if (i >= 0) subs.splice(i, 1);
      };
    };
  }
  return {
    backend,
    subs,
    emit: (eventType: string, data: unknown): void => {
      for (const s of subs) if (s.eventType === eventType) s.cb(data);
    },
  };
}

describe('queryDataSource', () => {
  it('fetchAll normalizes array response', async () => {
    const { backend } = fakeBackend({ response: [{ id: 1 }, { id: 2 }] });
    const ds = queryDataSource(backend, '/pages');
    const result = await ds.fetchAll();
    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.total).toBe(2);
  });

  it('fetchAll normalizes envelope response', async () => {
    const { backend } = fakeBackend({ response: { rows: [{ id: 1 }], total: 42 } });
    const ds = queryDataSource(backend, '/pages');
    const result = await ds.fetchAll();
    expect(result.rows).toEqual([{ id: 1 }]);
    expect(result.total).toBe(42);
  });

  it('fetchAll on unexpected payload returns []', async () => {
    const { backend } = fakeBackend({ response: null });
    const ds = queryDataSource(backend, '/pages');
    const result = await ds.fetchAll();
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('subscribe emits reload on matching resourceType', () => {
    const { backend, emit } = fakeBackend({ response: [] });
    const ds = queryDataSource(backend, '/pages', { resourceType: 'page' });
    const patches: RowPatch[] = [];
    ds.subscribe!((p) => patches.push(p));

    emit('projection.updated', { resourceType: 'page', resourceId: 'a' });
    emit('projection.updated', { resourceType: 'other', resourceId: 'b' });
    emit('projection.updated', { resourceType: 'page', resourceId: 'c' });

    expect(patches.length).toBe(2);
    expect(patches[0]!.type).toBe('reload');
    expect(patches[1]!.type).toBe('reload');
  });

  it('honours onEvent converter', () => {
    const { backend, emit } = fakeBackend({ response: [] });
    const ds = queryDataSource(backend, '/pages', {
      resourceType: 'page',
      onEvent: (ev) => {
        const e = ev as { payload?: { id: string; title: string }; resourceId?: string };
        return e.payload
          ? { type: 'upsert', row: e.payload }
          : { type: 'remove', rowKey: e.resourceId! };
      },
    });
    const patches: RowPatch[] = [];
    ds.subscribe!((p) => patches.push(p));

    emit('projection.updated', { resourceType: 'page', resourceId: 'a', payload: { id: 'a', title: 'Hi' } });
    emit('projection.updated', { resourceType: 'page', resourceId: 'a' });

    expect(patches.length).toBe(2);
    expect(patches[0]!.type).toBe('upsert');
    expect((patches[0] as { type: 'upsert'; row: unknown }).row).toEqual({ id: 'a', title: 'Hi' });
    expect(patches[1]!.type).toBe('remove');
    expect((patches[1] as { type: 'remove'; rowKey: unknown }).rowKey).toBe('a');
  });

  it('subscribe unsubscribe detaches listener', () => {
    const { backend, subs, emit } = fakeBackend({ response: [] });
    const ds = queryDataSource(backend, '/pages');
    const patches: RowPatch[] = [];
    const unsub = ds.subscribe!((p) => patches.push(p));
    expect(subs.length).toBe(1);
    unsub();
    expect(subs.length).toBe(0);
    emit('projection.updated', { resourceType: 'page' });
    expect(patches.length).toBe(0);
  });

  it('capabilities includes stream only when subscribe is available', () => {
    const streaming = queryDataSource(fakeBackend({ response: [], subscribe: true }).backend, '/x');
    const static_ = queryDataSource(fakeBackend({ response: [], subscribe: false }).backend, '/x');
    expect(streaming.capabilities?.includes('stream')).toBe(true);
    expect(static_.capabilities?.includes('stream')).toBe(false);
  });
});
