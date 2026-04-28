/**
 * DataSource — contract for supplying rows to <atlas-data-table>.
 *
 * v1 requires only `fetchAll`. The table performs sort/filter/page in memory.
 *
 * v2-ready: if a DataSource also exposes `fetchPage`, the table will call that
 * instead and skip client-side windowing. Consumers write columns and filters
 * once; the DataSource decides where the work happens.
 */

export type Row = Record<string, unknown>;

export interface DataSourceResult<R extends Row = Row> {
  rows: R[];
  total?: number;
  page?: number;
  pageSize?: number;
}

export interface FetchPageParams {
  page: number;
  pageSize: number;
  sortBy: string | null;
  sortDir: 'asc' | 'desc' | null;
  filters: Record<string, unknown>;
}

export type RowPatch<R extends Row = Row> =
  | { type: 'reload' }
  | { type: 'upsert'; row: R }
  | { type: 'remove'; rowKey: string | number };

export interface DataSource<R extends Row = Row> {
  /** Return every row. Core handles sort/filter/page in memory. */
  fetchAll(): Promise<DataSourceResult<R>>;
  /**
   * Optional. When present, the table calls this per page/sort/filter change
   * instead of `fetchAll`. Not used in v1.
   */
  fetchPage?(params: FetchPageParams): Promise<DataSourceResult<R>>;
  /** Optional streaming channel. Returns an unsubscribe. */
  subscribe?(cb: (patch: RowPatch<R>) => void): () => void;
  /** Optional list, e.g. ['sort', 'filter', 'stream']. */
  capabilities?: string[];
}

export const CAPABILITIES = Object.freeze({
  SORT: 'sort',
  FILTER: 'filter',
  PAGE: 'page',
  STREAM: 'stream',
} as const);
