/**
 * Widget contract for <atlas-data-table>.
 *
 * Parent surfaces may reference this contract in their `elements` list via
 * `{ name: 'pages-table', type: 'atlas-data-table', includes: contract }`.
 */

export const contract = {
  widgetId: 'atlas-data-table',
  kind: 'widget',
  purpose: 'Paginated, sortable, filterable table with optional SSE row streaming.',
  props: {
    columns: 'Array<ColumnConfig> (property only)',
    data:    'Array<Row> | DataSource | null',
    dataSource: 'DataSource (property only, alternative to `data`)',
    rowKey:  'string | (row) => key — default "id"',
    pageSize: 'number — 0 disables pagination',
    selection: '"none" | "single" | "multi"',
    density:   '"compact" | "cozy" | "comfortable"',
    resourceType: 'string — SSE stream filter via projection.updated',
    emptyHeading: 'string',
    emptyBody: 'string',
  },
  states: ['loading', 'empty', 'filtered-empty', 'error', 'success', 'unauthorized'],
  elements: [
    { name: '{name}-toolbar',       testId: '{surfaceId}.{name}-toolbar' },
    { name: '{name}-pagination',    testId: '{surfaceId}.{name}-pagination' },
    { name: '{name}-skeleton',      testId: '{surfaceId}.{name}-skeleton' },
    { name: '{name}-retry',         testId: '{surfaceId}.{name}-retry' },
    { name: '{name}-clear-filters', testId: '{surfaceId}.{name}-clear-filters' },
    { name: '{name}-header-{colKey}',  parameterized: true },
    { name: '{name}-filter-{colKey}',  parameterized: true },
    { name: '{name}-pagination-next',  testId: '{surfaceId}.{name}-pagination-next' },
    { name: '{name}-pagination-prev',  testId: '{surfaceId}.{name}-pagination-prev' },
    { name: '{name}-pagination-first', testId: '{surfaceId}.{name}-pagination-first' },
    { name: '{name}-pagination-last',  testId: '{surfaceId}.{name}-pagination-last' },
  ],
  events: {
    emits: [
      { name: 'row-selected',     detail: 'rowKey, row' },
      { name: 'row-unselected',   detail: 'rowKey' },
      { name: 'row-activated',    detail: 'rowKey, row' },
      { name: 'sort-change',      detail: 'columnKey, direction' },
      { name: 'filter-change',    detail: 'columnKey, value' },
      { name: 'filter-cleared',   detail: '' },
      { name: 'page-change',      detail: 'page, pageSize' },
      { name: 'stream-patch-applied', detail: 'type, rowKey' },
    ],
    listens: [
      { name: 'projection.updated', transport: 'sse',
        behavior: 'reload or patch rows when resource-type matches' },
    ],
  },
  telemetryEvents: [
    '{surfaceId}.{name}.sort-changed',
    '{surfaceId}.{name}.filter-applied',
    '{surfaceId}.{name}.filter-cleared',
    '{surfaceId}.{name}.page-changed',
    '{surfaceId}.{name}.page-size-changed',
    '{surfaceId}.{name}.row-selected',
    '{surfaceId}.{name}.row-unselected',
    '{surfaceId}.{name}.row-activated',
    '{surfaceId}.{name}.stream-patch-applied',
  ],
};
