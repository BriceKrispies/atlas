import { describe, it, expect } from 'vitest';
import { queryDataSource } from '../src/data-source/query-data-source.ts';
import type { BackendLike } from '../src/data-source/query-data-source.ts';
import type { Row, RowPatch } from '../src/data-source/types.ts';
import { assertDefined } from '@atlas/test-fixtures/assert';

interface FakeBackendResult {
  backend: BackendLike;
  subs: Array<{ eventType: string; cb: (e: unknown) => void }>;
  emit: (eventType: string, data: unknown) => void;
}

type ResponseFn = (p: string) => unknown;

function fakeBackend(
  { response, subscribe = true }: { response?: unknown | ResponseFn; subscribe?: boolean } = {},
): FakeBackendResult {
  const subs: Array<{ eventType: string; cb: (e: unknown) => void }> = [];
  const backend: BackendLike = {
    async query(path: string): Promise<unknown> {
      if (typeof response === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: union response is `unknown | ResponseFn`; typeof check narrows to fn but TS can't see through the union for `unknown`.
        return (response as ResponseFn)(path);
      }
      return response;
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

/** Boundary: subscribe is declared optional on `DataSource`; every test in
 *  this file constructs a backend with `subscribe: true`, so the runtime
 *  guarantee is local. Centralise the narrowing here. */
function subscribeOrThrow<R extends Row>(
  ds: { subscribe?: (cb: (p: RowPatch<R>) => void) => () => void },
  cb: (p: RowPatch<R>) => void,
): () => void {
  const fn = assertDefined(ds.subscribe, 'data source subscribe (constructed with subscribe:true)');
  return fn(cb);
}

/** Boundary: incoming event payload is `unknown` from `BackendLike.subscribe`;
 *  the test crafts the shape and reads it back with a runtime check. */
interface ProjectionEvent {
  payload?: { id: string; title: string };
  resourceId?: string;
}
function asProjectionEvent(ev: unknown): ProjectionEvent {
  if (ev === null || typeof ev !== 'object') {
    throw new Error('Test invariant violation: projection event must be an object');
  }
  return ev as ProjectionEvent;
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
    subscribeOrThrow(ds, (p) => patches.push(p));

    emit('projection.updated', { resourceType: 'page', resourceId: 'a' });
    emit('projection.updated', { resourceType: 'other', resourceId: 'b' });
    emit('projection.updated', { resourceType: 'page', resourceId: 'c' });

    expect(patches.length).toBe(2);
    expect(assertDefined(patches[0], 'patches[0] after length==2 check').type).toBe('reload');
    expect(assertDefined(patches[1], 'patches[1] after length==2 check').type).toBe('reload');
  });

  it('honours onEvent converter', () => {
    const { backend, emit } = fakeBackend({ response: [] });
    const ds = queryDataSource(backend, '/pages', {
      resourceType: 'page',
      onEvent: (ev) => {
        const e = asProjectionEvent(ev);
        return e.payload
          ? { type: 'upsert', row: e.payload }
          : { type: 'remove', rowKey: assertDefined(e.resourceId, 'resourceId on remove-path event') };
      },
    });
    const patches: RowPatch[] = [];
    subscribeOrThrow(ds, (p) => patches.push(p));

    emit('projection.updated', { resourceType: 'page', resourceId: 'a', payload: { id: 'a', title: 'Hi' } });
    emit('projection.updated', { resourceType: 'page', resourceId: 'a' });

    expect(patches.length).toBe(2);
    const upsert = assertDefined(patches[0], 'patches[0] after length==2 check');
    expect(upsert.type).toBe('upsert');
    if (upsert.type !== 'upsert') throw new Error('test invariant: expected upsert patch');
    expect(upsert.row).toEqual({ id: 'a', title: 'Hi' });
    const remove = assertDefined(patches[1], 'patches[1] after length==2 check');
    expect(remove.type).toBe('remove');
    if (remove.type !== 'remove') throw new Error('test invariant: expected remove patch');
    expect(remove.rowKey).toBe('a');
  });

  it('subscribe unsubscribe detaches listener', () => {
    const { backend, subs, emit } = fakeBackend({ response: [] });
    const ds = queryDataSource(backend, '/pages');
    const patches: RowPatch[] = [];
    const unsub = subscribeOrThrow(ds, (p) => patches.push(p));
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
