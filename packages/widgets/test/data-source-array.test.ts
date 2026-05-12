import { describe, it, expect } from 'vitest';
import { arrayDataSource } from '../src/data-source/array-data-source.ts';
import type { RowPatch } from '../src/data-source/types.ts';
import { assertDefined } from '@atlas/test-fixtures/assert';

describe('arrayDataSource', () => {
  it('fetchAll returns a copy with total', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const ds = arrayDataSource(rows);
    const result = await ds.fetchAll();
    expect(result.rows).toEqual(rows);
    expect(result.rows).not.toBe(rows);
    expect(result.total).toBe(2);
  });

  it('tolerates non-array input', async () => {
    const ds = arrayDataSource(null);
    const result = await ds.fetchAll();
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('subscribe emits reload on setRows', () => {
    const ds = arrayDataSource([{ id: 1 }]);
    const events: RowPatch[] = [];
    const subscribe = assertDefined(
      ds.subscribe,
      'arrayDataSource always exposes a subscribe channel',
    );
    const unsub = subscribe((p) => events.push(p));
    ds.setRows([{ id: 1 }, { id: 2 }]);
    expect(events.length).toBe(1);
    expect(
      assertDefined(events[0], 'subscribe must have delivered one patch').type,
    ).toBe('reload');
    unsub();
    ds.setRows([]);
    expect(events.length).toBe(1);
  });

  it('emit forwards patches to subscribers', () => {
    const ds = arrayDataSource();
    const events: RowPatch[] = [];
    const subscribe = assertDefined(
      ds.subscribe,
      'arrayDataSource always exposes a subscribe channel',
    );
    subscribe((p) => events.push(p));
    ds.emit({ type: 'upsert', row: { id: 1 } });
    ds.emit({ type: 'remove', rowKey: 1 });
    expect(events.length).toBe(2);
    expect(
      assertDefined(events[0], 'first patch must have been delivered').type,
    ).toBe('upsert');
    expect(
      assertDefined(events[1], 'second patch must have been delivered').type,
    ).toBe('remove');
  });

  it('capabilities includes stream', () => {
    const ds = arrayDataSource();
    expect(ds.capabilities?.includes('stream')).toBe(true);
  });
});
