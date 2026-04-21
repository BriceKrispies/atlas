/**
 * Seed page documents shipped with @atlas/bundle-standard.
 *
 * These are realistic sample pages that demonstrate the two templates
 * provided by the bundle. They are consumed by the sandbox app's
 * content-page demo and by the bundle's register test, which asserts
 * that every seed doc validates against `page_document.schema.json`.
 */

import welcome from './welcome.json' with { type: 'json' };
import about from './about.json' with { type: 'json' };
import dashboard from './dashboard.json' with { type: 'json' };
import galleryThreeColumn from './gallery-three-column.json' with { type: 'json' };
import galleryHeaderMainFooter from './gallery-header-main-footer.json' with { type: 'json' };
import galleryHeroAndGrid from './gallery-hero-and-grid.json' with { type: 'json' };
import galleryDashboardTiles from './gallery-dashboard-tiles.json' with { type: 'json' };

export const seedPages = [welcome, about, dashboard];

/**
 * Layout gallery pages — the same widget set rendered into each of the
 * bundle's templates so the sandbox can show layouts side by side. Kept
 * separate from the core `seedPages` so apps that only want the
 * canonical content don't pick these up automatically.
 */
export const gallerySeedPages = [
  galleryThreeColumn,
  galleryHeaderMainFooter,
  galleryHeroAndGrid,
  galleryDashboardTiles,
];
