export const contract = {
  widgetId: 'atlas-kpi-tile',
  kind: 'widget',
  purpose: 'Compact headline-number tile with optional trend + inline sparkline.',
  props: {
    value: 'string | number',
    label: 'string',
    unit:  'string',
    trend: "'up' | 'down' | 'flat'",
    trendLabel: 'string — supporting caption next to the trend arrow',
    sparklineValues: 'comma-separated numbers — renders an <atlas-sparkline>',
  },
};
