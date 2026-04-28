/**
 * queryDataSource — DataSource backed by the Atlas backend adapter.
 *
 * Example:
 *   queryDataSource(backend, '/pages', { resourceType: 'page' })
 */

import type { DataSource, DataSourceResult, Row, RowPatch } from './types.ts';

export interface BackendLike {
  query(path: string): Promise<unknown>;
  subscribe?(eventType: string, cb: (event: unknown) => void): () => void;
}

export interface QueryDataSourceOptions<R extends Row = Row> {
  /** when set, only events with this resourceType trigger a patch. */
  resourceType?: string;
  /** custom event-to-patch converter. Return null to ignore the event. */
  onEvent?: (event: unknown) => RowPatch<R> | null | undefined;
  /** SSE event type to subscribe to. Defaults to `'projection.updated'`. */
  eventType?: string;
}

export function queryDataSource<R extends Row = Row>(
  backend: BackendLike,
  path: string,
  options: QueryDataSourceOptions<R> = {},
): DataSource<R> {
  const resourceType = options.resourceType ?? null;
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
  const eventType = options.eventType ?? 'projection.updated';

  const capabilities: string[] = ['sort', 'filter', 'page'];
  if (typeof backend?.subscribe === 'function') capabilities.push('stream');

  return {
    capabilities,

    async fetchAll(): Promise<DataSourceResult<R>> {
      const result: unknown = await backend.query(path);
      const resultObj = result as { rows?: unknown; total?: unknown } | null;
      const rows: R[] = Array.isArray(result)
        ? (result as R[])
        : Array.isArray(resultObj?.rows)
          ? (resultObj!.rows as R[])
          : [];
      const total = typeof resultObj?.total === 'number' ? resultObj.total : rows.length;
      return { rows, total };
    },

    subscribe(cb: (patch: RowPatch<R>) => void): () => void {
      if (typeof cb !== 'function' || typeof backend?.subscribe !== 'function') {
        return () => {};
      }
      return backend.subscribe(eventType, (event: unknown) => {
        const ev = event as { resourceType?: unknown } | null;
        if (resourceType && ev?.resourceType !== resourceType) return;
        if (onEvent) {
          const patch = onEvent(event);
          if (patch && typeof patch === 'object') cb(patch);
          return;
        }
        cb({ type: 'reload' });
      });
    },
  };
}
