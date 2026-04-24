/**
 * Bundled preset layouts. Import via side effect or pass each doc into a
 * consumer's LayoutRegistry / LayoutStore.
 */

import type { LayoutDocument } from '../layout-document.ts';

import oneColumn from './one-column.json' with { type: 'json' };
import twoColumn from './two-column.json' with { type: 'json' };
import threeColumn from './three-column.json' with { type: 'json' };
import headerMainFooter from './header-main-footer.json' with { type: 'json' };
import heroAndGrid from './hero-and-grid.json' with { type: 'json' };
import dashboardTiles from './dashboard-tiles.json' with { type: 'json' };

export const presetLayouts: LayoutDocument[] = [
  oneColumn as LayoutDocument,
  twoColumn as LayoutDocument,
  threeColumn as LayoutDocument,
  headerMainFooter as LayoutDocument,
  heroAndGrid as LayoutDocument,
  dashboardTiles as LayoutDocument,
];

export {
  oneColumn,
  twoColumn,
  threeColumn,
  headerMainFooter,
  heroAndGrid,
  dashboardTiles,
};
