// Atlas widgets — composed, data-aware custom elements.
//
// Side-effect imports register each element with customElements.
// Consumers just `import '@atlas/widgets'` to pick up everything.

import '@atlas/design';
import './styles.css';

// Data table
import './data-table/atlas-data-table-header-cell.js';
import './data-table/atlas-table-toolbar.js';
import './data-table/atlas-pagination.js';
import './data-table/atlas-data-table.js';

// Charts — registered incrementally as each element lands.

export * from './data-source/index.js';
