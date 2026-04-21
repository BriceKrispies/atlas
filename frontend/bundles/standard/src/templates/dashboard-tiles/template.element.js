/**
 * DashboardTilesTemplate — responsive tile grid. Cells auto-flow into
 * columns sized by the viewport; good for widgets that all want equal
 * real estate (metrics, status panels). CSS-only chrome; see
 * ../templates.css for the grid rules.
 */

import { AtlasElement } from '@atlas/core';

export class DashboardTilesTemplate extends AtlasElement {}

AtlasElement.define('template-dashboard-tiles', DashboardTilesTemplate);
