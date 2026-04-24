// Atlas design system — tokens + element styles + custom element registration
import './tokens.css';
import './elements.css';

export { BREAKPOINTS, matchesBreakpoint } from './breakpoints.ts';
export type { BreakpointName } from './breakpoints.ts';

// Interactive elements (Shadow DOM)
import './atlas-button.ts';
import './atlas-input.ts';
import './atlas-multi-select.ts';
import './atlas-skeleton.ts';
import './atlas-badge.ts';
import './atlas-tab-bar.ts';

// Layout elements (Light DOM)
import './atlas-box.ts';
import './atlas-text.ts';
import './atlas-heading.ts';
import './atlas-stack.ts';

// Table elements (Light DOM)
import './atlas-table.ts';
import './atlas-row.ts';
import './atlas-table-head.ts';
import './atlas-table-body.ts';
import './atlas-table-cell.ts';

// Navigation elements (Light DOM)
import './atlas-nav.ts';
import './atlas-nav-item.ts';
