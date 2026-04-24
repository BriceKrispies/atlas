// Atlas widgets — composed, data-aware custom elements.
//
// Side-effect imports register each element with customElements.
// Consumers just `import '@atlas/widgets'` to pick up everything.

import '@atlas/design';
import './styles.css';

// Data table
import './data-table/atlas-table-toolbar.js';
import './data-table/atlas-pagination.js';
import './data-table/atlas-data-table.js';

// Charts
import './charts/atlas-chart-tooltip.js';
import './charts/atlas-chart-legend.js';
import './charts/atlas-chart.js';
import './charts/atlas-sparkline.js';
import './charts/atlas-kpi-tile.js';
import './charts/atlas-chart-card.js';
import './charts/atlas-chart-time-range.js';
import './charts/atlas-chart-filter-panel.js';
import './charts/atlas-chart-drilldown.js';
import './charts/atlas-chart-export-button.js';
import './charts/atlas-chart-config-panel.js';

export * from './data-source/index.js';
