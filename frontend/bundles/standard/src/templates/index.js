/**
 * Templates barrel — browser-side entry for apps that want to load the
 * bundle's page templates.
 *
 * Importing this module:
 *   1. Pulls in the shared `templates.css` layout chrome (bundler side
 *      effect — Vite/rollup handle the CSS import).
 *   2. Registers the <template-one-column> and <template-two-column>
 *      custom elements.
 *   3. Re-exports the `{ manifest, element }` pair for each template.
 *
 * Node-based tests that cannot consume raw CSS imports should import
 * each template module directly (see ../register.js) instead of this
 * barrel.
 */

import './templates.css';

export * as oneColumn from './one-column/index.js';
export * as twoColumn from './two-column/index.js';
