import { S } from '../_register.ts';
// Vite `?url` import returns a string URL to the served module file.
// This is the bridge between our bundler-driven dev setup and iframe
// isolation: sandboxed frames cannot resolve bare specifiers, so the
// host must hand them a concrete URL.
// The module must export `element` (the widget class); the widget's
// `index.js` does that re-export from `widget.element.js`.
import announcementsWidgetUrl from '@atlas/bundle-standard/widgets/announcements?url';
// @atlas/design registers the atlas-* custom elements. Inline widgets
// inherit the main page's registrations, but an iframe has its own
// realm — the boot script loads this URL before the widget so
// <atlas-box>, <atlas-heading>, etc. are defined in that realm too.
import atlasDesignUrl from '@atlas/design?url';
// Per-widget harness fixtures. Lives next to the widget; imported as
// JSON so it ships as a static asset rather than code.
import announcementsHarnessSpec from '@atlas/bundle-standard/widgets/announcements/harness.fixtures.json';

import { arrayDataSource } from '@atlas/widgets';

// ── Widgets ─────────────────────────────────────────────────────
//
// Widget specimens use the live `mount` shape: the sandbox creates a
// real <widget-host> and wires a sandbox-local capability bridge that
// returns fake data so the widget runs end-to-end without a backend.
// This is the same contract the admin app will use in production, just
// with mocked capabilities. See specs/crosscut/widgets.md.

// Widget specimen: a single top-level <widget-harness> that owns its own
// config-variant switcher, live mediator/bridge trace logs, and a
// synthetic-publish panel. The sandbox shell just hands it a container.
function mountAnnouncementsHarness(demoEl: HTMLElement): () => void {
  const harness = document.createElement('widget-harness') as HTMLElement & {
    spec: unknown;
    widgetId: string;
    resolveWidgetModuleUrl: (widgetId: string) =>
      | string
      | { url: string; supportUrls?: string[] }
      | null;
  };
  harness.spec = announcementsHarnessSpec;
  harness.widgetId = 'content.announcements';
  harness.resolveWidgetModuleUrl = (widgetId: string) =>
    widgetId === 'content.announcements'
      ? { url: announcementsWidgetUrl, supportUrls: [atlasDesignUrl] }
      : null;
  demoEl.appendChild(harness);
  return () => {
    try { harness.remove(); } catch { /* already detached */ }
  };
}

S({
  id: 'widget.content.announcements',
  name: 'Announcements',
  tag: 'widget-harness',
  mount: mountAnnouncementsHarness,
  // No configVariants — the harness owns its own variant switcher from
  // the fixture file so variants stay colocated with the widget.
  configVariants: [{ name: 'Harness', config: {} }],
});


// ── @atlas/widgets ──────────────────────────────────────────────

interface SampleRow {
  id: number;
  title: string;
  status: string;
  score: number;
  updated: string;
  [key: string]: unknown;
}

const SAMPLE_TABLE_ROWS: SampleRow[] = [
  { id: 1,  title: 'Welcome Page',          status: 'published', score: 82, updated: '2026-04-10' },
  { id: 2,  title: 'About Us',              status: 'draft',     score: 47, updated: '2026-04-08' },
  { id: 3,  title: 'FAQ',                   status: 'archived',  score: 5,  updated: '2026-03-15' },
  { id: 4,  title: 'Careers',               status: 'published', score: 64, updated: '2026-04-02' },
  { id: 5,  title: 'Press',                 status: 'published', score: 33, updated: '2026-02-28' },
  { id: 6,  title: 'Privacy Policy',        status: 'published', score: 12, updated: '2026-01-14' },
  { id: 7,  title: 'Terms of Service',      status: 'published', score: 9,  updated: '2026-01-14' },
  { id: 8,  title: 'Support Home',          status: 'draft',     score: 71, updated: '2026-04-20' },
  { id: 9,  title: 'Release Notes',         status: 'published', score: 58, updated: '2026-04-18' },
  { id: 10, title: 'Changelog',             status: 'published', score: 22, updated: '2026-04-17' },
  { id: 11, title: 'Developer Blog',        status: 'draft',     score: 77, updated: '2026-04-15' },
  { id: 12, title: 'Security Advisories',   status: 'archived',  score: 3,  updated: '2025-11-02' },
];

const SAMPLE_TABLE_COLUMNS = [
  { key: 'title',   label: 'Title',  sortable: true, filter: { type: 'text' } },
  { key: 'status',  label: 'Status', sortable: true, filter: { type: 'select' }, format: 'status' },
  { key: 'score',   label: 'Score',  sortable: true, filter: { type: 'range' }, align: 'end', format: 'number' },
  { key: 'updated', label: 'Updated', sortable: true, format: 'date' },
];

interface DataTableMountConfig {
  pageSize?: number;
  selection?: string;
  emptyHeading?: string;
  streaming?: boolean;
  data?: SampleRow[];
}

function mountDataTable(
  demo: HTMLElement,
  ctx: { config: Record<string, unknown>; onLog: (kind: string, payload: unknown) => void },
): () => void {
  const { onLog } = ctx;
  const config = ctx.config as unknown as DataTableMountConfig;
  const table = document.createElement('atlas-data-table') as HTMLElement & {
    columns: unknown;
    data?: unknown;
    dataSource?: unknown;
  };
  table.setAttribute('name', 'table');
  table.setAttribute('label', 'Sample pages');
  if (config.pageSize != null) table.setAttribute('page-size', String(config.pageSize));
  if (config.selection) table.setAttribute('selection', config.selection);
  if (config.emptyHeading) table.setAttribute('empty-heading', config.emptyHeading);
  table.columns = SAMPLE_TABLE_COLUMNS;

  // Streaming variant wires an arrayDataSource (which supports subscribe)
  // and hangs an imperative emit handle on window.__atlasTestDataSource
  // so Playwright can inject patches via page.evaluate.
  if (config.streaming) {
    const ds = arrayDataSource(config.data ?? SAMPLE_TABLE_ROWS);
    table.dataSource = ds;
    (typeof window !== 'undefined' ? window : globalThis as unknown as Window)
      .__atlasTestDataSource = ds;
  } else {
    table.data = config.data ?? SAMPLE_TABLE_ROWS;
  }

  const events = [
    'sort-change', 'filter-change', 'filter-cleared', 'page-change',
    'row-selected', 'row-unselected', 'row-activated', 'stream-patch-applied',
  ];
  const handlers: Array<[string, EventListener]> = events.map((ev) => {
    const h: EventListener = (e) => onLog(ev, (e as CustomEvent).detail ?? {});
    table.addEventListener(ev, h);
    return [ev, h];
  });

  demo.appendChild(table);
  return () => {
    for (const [ev, h] of handlers) table.removeEventListener(ev, h);
    table.remove();
    if (typeof window !== 'undefined' && window.__atlasTestDataSource) {
      delete window.__atlasTestDataSource;
    }
  };
}

S({
  id: 'widgets.data-table',
  name: 'Data table',
  tag: 'atlas-data-table',
  mount: mountDataTable,
  configVariants: [
    { name: 'Default',    config: { pageSize: 5 } },
    { name: 'Small page', config: { pageSize: 3 } },
    { name: 'No pagination', config: { pageSize: 0 } },
    { name: 'Single-select', config: { pageSize: 5, selection: 'single' } },
    { name: 'Multi-select',  config: { pageSize: 5, selection: 'multi' } },
    { name: 'Streaming',   config: { pageSize: 5, streaming: true } },
    { name: 'Empty',  config: { pageSize: 5, data: [], emptyHeading: 'No results found' } },
  ],
});


// ── Charts ──────────────────────────────────────────────────────

const SAMPLE_SERIES = {
  series: [
    { name: 'Logins',    values: [1, 3, 5, 4, 7, 9, 12] },
    { name: 'Sign-ups',  values: [0, 1, 2, 3, 4, 6, 8] },
  ],
};

const SAMPLE_TIME_SERIES = {
  series: [
    {
      name: 'Revenue',
      values: [
        { x: '2026-01-01', y: 120 },
        { x: '2026-02-01', y: 180 },
        { x: '2026-03-01', y: 160 },
        { x: '2026-04-01', y: 220 },
      ],
    },
  ],
};

const SAMPLE_BAR = {
  series: [
    { name: 'Desktop', values: [{ x: 'Q1', y: 30 }, { x: 'Q2', y: 45 }, { x: 'Q3', y: 60 }, { x: 'Q4', y: 50 }] },
    { name: 'Mobile',  values: [{ x: 'Q1', y: 20 }, { x: 'Q2', y: 35 }, { x: 'Q3', y: 40 }, { x: 'Q4', y: 55 }] },
  ],
};

const SAMPLE_SLICES = {
  slices: [
    { label: 'Blog',   value: 40 },
    { label: 'Docs',   value: 25 },
    { label: 'FAQ',    value: 15 },
    { label: 'Home',   value: 20 },
  ],
};

interface ChartMountConfig {
  type?: string;
  height?: string;
  label?: string;
  showLegend?: boolean;
  innerRadius?: number;
  data?: unknown;
}

function mountChart(
  demo: HTMLElement,
  ctx: { config: Record<string, unknown>; onLog: (kind: string, payload: unknown) => void },
): () => void {
  const { onLog } = ctx;
  const config = ctx.config as unknown as ChartMountConfig;
  const chart = document.createElement('atlas-chart') as HTMLElement & { data: unknown };
  chart.setAttribute('name', 'chart');
  chart.setAttribute('type', config.type ?? 'line');
  if (config.height) chart.setAttribute('height', config.height);
  if (config.label) chart.setAttribute('label', config.label);
  if (config.showLegend) chart.setAttribute('show-legend', '');
  if (config.innerRadius != null) chart.setAttribute('inner-radius', String(config.innerRadius));
  chart.data = config.data;

  const handler: EventListener = (e) => onLog(e.type, (e as CustomEvent).detail ?? {});
  chart.addEventListener('point-focus', handler);
  chart.addEventListener('point-blur', handler);

  demo.appendChild(chart);
  return () => {
    chart.removeEventListener('point-focus', handler);
    chart.removeEventListener('point-blur', handler);
    chart.remove();
  };
}

S({
  id: 'widgets.chart',
  name: 'Chart',
  tag: 'atlas-chart',
  mount: mountChart,
  configVariants: [
    { name: 'Line (simple)',    config: { type: 'line',  data: SAMPLE_SERIES, label: 'Logins vs sign-ups', showLegend: true } },
    { name: 'Line (time)',      config: { type: 'line',  data: SAMPLE_TIME_SERIES, label: 'Monthly revenue' } },
    { name: 'Area',             config: { type: 'area',  data: SAMPLE_SERIES, showLegend: true } },
    { name: 'Bar',              config: { type: 'bar',   data: SAMPLE_BAR, showLegend: true } },
    { name: 'Stacked bar',      config: { type: 'stacked-bar', data: SAMPLE_BAR, showLegend: true } },
    { name: 'Pie',              config: { type: 'pie',   data: SAMPLE_SLICES } },
    { name: 'Donut',            config: { type: 'donut', data: SAMPLE_SLICES, innerRadius: 0.6 } },
  ],
});


// ── Chart card (full interactive surface) ───────────────────────
//
// Demonstrates the committed-state contract (see interaction-contracts.md):
// one <atlas-chart-card> owns a ChartStateStore; children (config, time
// range, filters, legend, drilldown, export) commit intents that the
// __atlasTest registry exposes to Playwright.

const CARD_BAR_DATA = {
  series: [
    { id: 'desktop', name: 'Desktop', color: '#4b7bec',
      values: [{ x: 'Q1', y: 30, region: 'NA' }, { x: 'Q2', y: 45, region: 'NA' }, { x: 'Q3', y: 60, region: 'EU' }, { x: 'Q4', y: 50, region: 'APAC' }] },
    { id: 'mobile', name: 'Mobile', color: '#26de81',
      values: [{ x: 'Q1', y: 20, region: 'NA' }, { x: 'Q2', y: 35, region: 'EU' }, { x: 'Q3', y: 40, region: 'EU' }, { x: 'Q4', y: 55, region: 'APAC' }] },
  ],
};

const CARD_DRILLDOWNS = {
  desktop: {
    series: [
      { id: 'desktop-chrome', name: 'Chrome', values: [{ x: 'Q1', y: 18 }, { x: 'Q2', y: 28 }, { x: 'Q3', y: 38 }, { x: 'Q4', y: 32 }] },
      { id: 'desktop-safari', name: 'Safari', values: [{ x: 'Q1', y: 7 }, { x: 'Q2', y: 11 }, { x: 'Q3', y: 14 }, { x: 'Q4', y: 12 }] },
      { id: 'desktop-firefox', name: 'Firefox', values: [{ x: 'Q1', y: 5 }, { x: 'Q2', y: 6 }, { x: 'Q3', y: 8 }, { x: 'Q4', y: 6 }] },
    ],
  },
  mobile: {
    series: [
      { id: 'mobile-ios', name: 'iOS', values: [{ x: 'Q1', y: 12 }, { x: 'Q2', y: 21 }, { x: 'Q3', y: 24 }, { x: 'Q4', y: 33 }] },
      { id: 'mobile-android', name: 'Android', values: [{ x: 'Q1', y: 8 }, { x: 'Q2', y: 14 }, { x: 'Q3', y: 16 }, { x: 'Q4', y: 22 }] },
    ],
  },
};

interface ChartCardMountConfig {
  chartId?: string;
  data?: unknown;
  drilldowns?: unknown;
}

function mountChartCard(
  demo: HTMLElement,
  ctx: { config: Record<string, unknown>; onLog: (kind: string, payload: unknown) => void },
): () => void {
  const { onLog } = ctx;
  const config = ctx.config as unknown as ChartCardMountConfig;
  const card = document.createElement('atlas-chart-card') as HTMLElement & {
    data: unknown;
    drilldowns: unknown;
    initialConfig: unknown;
  };
  card.setAttribute('chart-id', config.chartId ?? 'sales');

  card.innerHTML = `
    <atlas-chart-config-panel>
      <atlas-chart-config-field field="type" label="Type" options="bar,line,area,stacked-bar"></atlas-chart-config-field>
    </atlas-chart-config-panel>
    <atlas-chart-time-range presets="1d,7d,30d,all"></atlas-chart-time-range>
    <atlas-chart-filter-panel>
      <atlas-chart-filter field="region" op="=" label="Region">
        <option value="NA">North America</option>
        <option value="EU">Europe</option>
        <option value="APAC">APAC</option>
      </atlas-chart-filter>
    </atlas-chart-filter-panel>
    <atlas-chart-drilldown></atlas-chart-drilldown>
    <atlas-chart type="bar" height="240px" label="Sales by device" show-axes></atlas-chart>
    <atlas-chart-legend></atlas-chart-legend>
    <atlas-chart-export-button format="csv" label="Export CSV"></atlas-chart-export-button>
    <atlas-chart-export-button format="png" label="Export PNG"></atlas-chart-export-button>
  `;

  card.data = config.data ?? CARD_BAR_DATA;
  card.drilldowns = config.drilldowns ?? CARD_DRILLDOWNS;
  card.initialConfig = { type: 'bar' };

  demo.appendChild(card);

  const logHandler: EventListener = (e) => onLog(e.type, (e as CustomEvent).detail ?? {});
  card.addEventListener('point-click', logHandler);

  return () => {
    card.removeEventListener('point-click', logHandler);
    card.remove();
  };
}

S({
  id: 'widgets.chart-card',
  name: 'Chart card (stateful)',
  tag: 'atlas-chart-card',
  mount: mountChartCard,
  configVariants: [
    { name: 'Sales by device', config: { chartId: 'sales', data: CARD_BAR_DATA, drilldowns: CARD_DRILLDOWNS } },
  ],
});


// ── Sparkline & KPI tile ────────────────────────────────────────

S({
  id: 'widgets.sparkline',
  name: 'Sparkline',
  tag: 'atlas-sparkline',
  variants: [
    {
      name: 'Basic',
      html: `<atlas-sparkline values="1,3,5,4,7,9,8,12,11,14" label="Signups this week" style="width:140px"></atlas-sparkline>`,
    },
    {
      name: 'With last-point marker',
      html: `<atlas-sparkline values="50,42,48,55,70,65,78" show-last-point style="width:160px"></atlas-sparkline>`,
    },
    {
      name: 'Custom color',
      html: `<atlas-sparkline values="10,22,18,26,19,30,24" color="#16a34a" style="width:140px"></atlas-sparkline>`,
    },
  ],
});

S({
  id: 'widgets.kpi-tile',
  name: 'KPI tile',
  tag: 'atlas-kpi-tile',
  variants: [
    {
      name: 'Value + trend',
      html: `
        <atlas-kpi-tile
          label="Daily active users"
          value="12,482"
          trend="up"
          trend-label="+5.2% vs. last week"
        ></atlas-kpi-tile>
      `,
    },
    {
      name: 'With sparkline',
      html: `
        <atlas-kpi-tile
          label="API latency"
          value="124"
          unit="ms"
          trend="down"
          trend-label="−12ms vs. yesterday"
          sparkline-values="180,170,160,155,150,140,124"
        ></atlas-kpi-tile>
      `,
    },
    {
      name: 'Flat value',
      html: `
        <atlas-kpi-tile label="Error rate" value="0.02" unit="%" trend="flat" trend-label="stable"></atlas-kpi-tile>
      `,
    },
  ],
});

declare global {
  interface Window {
    __atlasTestDataSource?: unknown;
  }
}
