/**
 * Widget contract for <atlas-chart>.
 */
export const contract = {
  widgetId: 'atlas-chart',
  kind: 'widget',
  purpose: 'SVG-rendered chart for line/area/bar/stacked-bar/pie/donut types.',
  props: {
    type:        "'line' | 'area' | 'bar' | 'stacked-bar' | 'pie' | 'donut'",
    data:        'number[] | [x,y][] | {x,y}[] | {series} | {slices}',
    label:       'string — accessible name (role="img")',
    height:      'CSS length — default 240px',
    showLegend:  'boolean attribute',
    showAxes:    'boolean — defaults to on for cartesian, off for radial',
    innerRadius: 'number 0..1 — donut only, default 0.6',
  },
  states: ['loading', 'empty', 'success', 'error'],
  events: {
    emits: [
      { name: 'point-focus', detail: 'seriesIdx, index' },
      { name: 'point-blur' },
    ],
  },
  a11y: [
    'SVG root uses role="img" + aria-label',
    'Every point/slice/bar has <title> and tabindex="0"',
    'Visually-hidden <table> companion mirrors data for screen readers',
  ],
};
