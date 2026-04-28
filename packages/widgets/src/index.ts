// Atlas widgets — composed, data-aware custom elements.
//
// Side-effect imports register each element with customElements.
// Consumers just `import '@atlas/widgets'` to pick up everything.

import '@atlas/design';
import './styles.css';

// Data table
import './data-table/atlas-table-toolbar.ts';
import './data-table/atlas-pagination.ts';
import './data-table/atlas-data-table.ts';

// Charts
import './charts/atlas-chart-tooltip.ts';
import './charts/atlas-chart-legend.ts';
import './charts/atlas-chart.ts';
import './charts/atlas-sparkline.ts';
import './charts/atlas-kpi-tile.ts';
import './charts/atlas-chart-card.ts';
import './charts/atlas-chart-time-range.ts';
import './charts/atlas-chart-filter-panel.ts';
import './charts/atlas-chart-drilldown.ts';
import './charts/atlas-chart-export-button.ts';
import './charts/atlas-chart-config-panel.ts';

export * from './data-source/index.ts';
