/**
 * template.dashboard-tiles — public template entry.
 */

export const manifest = {
  templateId: 'template.dashboard-tiles',
  version: '0.1.0',
  displayName: 'Dashboard Tiles',
  description:
    'Responsive tile grid. Widgets flow into equal-width columns that auto-fit the viewport (min 260px per tile).',
  regions: [
    { name: 'tiles', required: true },
  ],
};

export { DashboardTilesTemplate as element } from './template.element.js';
