/**
 * @atlas/bundle-standard — the first-party Atlas UI bundle.
 *
 * Re-exports the widget modules plus the `registerAllWidgets` helper.
 * Importing widget modules triggers `AtlasSurface.define(...)` side
 * effects so the custom elements are available once this module is
 * loaded.
 */

export { registerAllWidgets } from './register.js';
export * as announcements from './widgets/announcements/index.js';
export * as messaging from './widgets/messaging/index.js';
export * as spreadsheetUploader from './widgets/spreadsheet-uploader/index.js';
