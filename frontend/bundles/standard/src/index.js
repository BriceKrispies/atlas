/**
 * @atlas/bundle-standard — the first-party Atlas UI bundle.
 *
 * Re-exports the widget and template modules plus the
 * `registerAllWidgets` / `registerAllTemplates` helpers. Importing the
 * widget modules triggers `AtlasSurface.define(...)` side effects; the
 * template barrel import additionally pulls in the shared layout CSS.
 */

export { registerAllWidgets, registerAllTemplates } from './register.js';
export * as announcements from './widgets/announcements/index.js';
export * as messaging from './widgets/messaging/index.js';
export * as spreadsheetUploader from './widgets/spreadsheet-uploader/index.js';
export * as oneColumn from './templates/one-column/index.js';
export * as twoColumn from './templates/two-column/index.js';
export * as threeColumn from './templates/three-column/index.js';
export * as headerMainFooter from './templates/header-main-footer/index.js';
export * as heroAndGrid from './templates/hero-and-grid/index.js';
export * as dashboardTiles from './templates/dashboard-tiles/index.js';
export { seedPages, gallerySeedPages } from './seed-pages/index.js';
