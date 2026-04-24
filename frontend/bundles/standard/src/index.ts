/**
 * @atlas/bundle-standard — the first-party Atlas UI bundle.
 *
 * Re-exports the widget and template modules plus the
 * `registerAllWidgets` / `registerAllTemplates` helpers. Importing the
 * widget modules triggers `AtlasSurface.define(...)` side effects; the
 * template barrel import additionally pulls in the shared layout CSS.
 */

export { registerAllWidgets, registerAllTemplates } from './register.ts';
export * as announcements from './widgets/announcements/index.ts';
export * as messaging from './widgets/messaging/index.ts';
export * as spreadsheetUploader from './widgets/spreadsheet-uploader/index.ts';
export * as oneColumn from './templates/one-column/index.ts';
export * as twoColumn from './templates/two-column/index.ts';
export * as threeColumn from './templates/three-column/index.ts';
export * as headerMainFooter from './templates/header-main-footer/index.ts';
export * as heroAndGrid from './templates/hero-and-grid/index.ts';
export * as dashboardTiles from './templates/dashboard-tiles/index.ts';
export { seedPages, gallerySeedPages } from './seed-pages/index.ts';
