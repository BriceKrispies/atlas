/**
 * DataSource — contract for supplying rows to <atlas-data-table>.
 *
 * v1 requires only `fetchAll`. The table performs sort/filter/page in memory.
 *
 * v2-ready: if a DataSource also exposes `fetchPage`, the table will call that
 * instead and skip client-side windowing. Consumers write columns and filters
 * once; the DataSource decides where the work happens.
 *
 * @typedef {Object} DataSourceResult
 * @property {Row[]} rows
 * @property {number} [total]
 * @property {number} [page]
 * @property {number} [pageSize]
 *
 * @typedef {Object} FetchPageParams
 * @property {number} page
 * @property {number} pageSize
 * @property {string | null} sortBy
 * @property {'asc' | 'desc' | null} sortDir
 * @property {Record<string, unknown>} filters
 *
 * @typedef {Object} RowPatch
 * @property {'upsert' | 'remove' | 'reload'} type
 * @property {Row} [row]
 * @property {string | number} [rowKey]
 *
 * @typedef {Object} DataSource
 * @property {() => Promise<DataSourceResult>} fetchAll
 *   Return every row. Core handles sort/filter/page in memory.
 * @property {(params: FetchPageParams) => Promise<DataSourceResult>} [fetchPage]
 *   Optional. When present, the table calls this per page/sort/filter change
 *   instead of `fetchAll`. Not used in v1.
 * @property {(cb: (patch: RowPatch) => void) => () => void} [subscribe]
 *   Optional streaming channel. Returns an unsubscribe.
 * @property {string[]} [capabilities]
 *   Optional list, e.g. ['sort', 'filter', 'stream'].
 *
 * @typedef {Record<string, unknown>} Row
 */

export const CAPABILITIES = Object.freeze({
  SORT: 'sort',
  FILTER: 'filter',
  PAGE: 'page',
  STREAM: 'stream',
});
