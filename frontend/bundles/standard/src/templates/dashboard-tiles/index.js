/**
 * template.dashboard-tiles — public template entry.
 */

export const manifest = {
  templateId: 'template.dashboard-tiles',
  version: '0.1.0',
  displayName: 'Dashboard Tiles',
  description:
    'A single tile slot. In the slot model this is a one-widget region.',
  regions: [
    { name: 'tiles', required: false },
  ],
};

export { DashboardTilesTemplate as element } from './template.element.js';
