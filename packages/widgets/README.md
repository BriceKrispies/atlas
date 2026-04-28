# @atlas/widgets

Composed, data-aware first-party widgets built on `@atlas/core` + `@atlas/design`.

Contents:

- `<atlas-data-table>` — paginated, sortable, filterable table with streaming row updates via SSE.
- `<atlas-chart type="line|area|bar|stacked-bar|pie|donut">` — analytics charts, SVG-rendered.
- `<atlas-sparkline>` — compact inline chart.
- `<atlas-kpi-tile>` — headline-number tile with optional trend.
- `DataSource` contract + `arrayDataSource` / `queryDataSource` built-ins.

## Distinction from `@atlas/widget-host`

`@atlas/widget-host` is a **runtime for sandboxed third-party widgets** with a
mediator + capability bridge (iframe isolation support). Its ESLint plugin
(`@atlas/eslint-plugin-widgets`) forbids direct DOM access and enforces
mediator-only cross-widget messaging.

`@atlas/widgets` (this package) is a **catalog of first-party composed
components** that use the DOM, SVG, and web platform APIs directly. It is
**not** subject to `@atlas/eslint-plugin-widgets` — applying those rules would
prohibit the SVG/DOM work these widgets require.

Both packages can coexist in the same app; they solve different problems.
