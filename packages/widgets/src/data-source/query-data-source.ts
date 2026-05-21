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
export function queryDataSource<R extends Row = Row>(backend: BackendLike, path: string, options: QueryDataSourceOptions<R> = {}): DataSource<R> {
    const resourceType = options.resourceType ?? null;
    const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
    const eventType = options.eventType ?? 'projection.updated';
    const capabilities: string[] = ['sort', 'filter', 'page'];
    if (typeof backend?.subscribe === 'function')
        capabilities.push('stream');
    return {
        capabilities,
        async fetchAll(): Promise<DataSourceResult<R>> {
            const result: unknown = await backend.query(path);
            // Trust the backend to return rows of type R — this is the
            // type-erasure boundary. Either the response is itself a row array,
            // or it is a `{ rows, total }` envelope. Anything else → empty.
            // The `unknown[] → R[]` cast is the explicit boundary: callers know
            // what shape their backend returns and pick R accordingly.
            let rowsUnknown: unknown[] = [];
            let total: number | null = null;
            if (Array.isArray(result)) {
                rowsUnknown = result;
            }
            else if (result !== null && typeof result === 'object') {
                const obj: {
                    rows?: unknown;
                    total?: unknown;
                } = result;
                if (Array.isArray(obj.rows)) {
                    rowsUnknown = obj.rows;
                }
                if (typeof obj.total === 'number') {
                    total = obj.total;
                }
            }
            const rows = rowsUnknown as R[];
            return { rows, total: total ?? rows.length };
        },
        subscribe(cb: (patch: RowPatch<R>) => void): () => void {
            if (typeof cb !== 'function' || typeof backend?.subscribe !== 'function') {
                return function () { };
            }
            return backend.subscribe(eventType, function (event: unknown) {
                if (resourceType) {
                    const evResource = event !== null && typeof event === 'object'
                        ? (event as {
                            resourceType?: unknown;
                        }).resourceType
                        : undefined;
                    if (evResource !== resourceType)
                        return;
                }
                if (onEvent) {
                    const patch = onEvent(event);
                    if (patch && typeof patch === 'object')
                        cb(patch);
                    return;
                }
                cb({ type: 'reload' });
            });
        },
    };
}
