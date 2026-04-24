import type { WidgetContract } from '../../data-table/contracts/atlas-data-table.widget.ts';

export const contract: WidgetContract = {
  widgetId: 'atlas-sparkline',
  kind: 'widget',
  purpose: 'Inline compact sparkline chart with no axes or legend.',
  props: {
    values: 'number[] (property) or comma-separated string (attribute)',
    color:  'CSS color; default --atlas-chart-color-1',
    label:  'accessible name',
    showLastPoint: 'boolean attribute',
  },
  a11y: ['role="img"', 'aria-label from label or point count'],
};
