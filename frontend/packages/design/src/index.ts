// Atlas design system — tokens + element styles + custom element registration
import './tokens.css';
import './elements.css';

export { BREAKPOINTS, matchesBreakpoint } from './breakpoints.ts';
export type { BreakpointName } from './breakpoints.ts';

// Shared utilities for element authors (also importable via '@atlas/design/util')
export { uid, escapeAttr, escapeText, createSheet, adoptSheet } from './util.ts';

// Interactive elements (Shadow DOM)
import './atlas-icon.ts';
import './atlas-button.ts';
import './atlas-input.ts';
import './atlas-multi-select.ts';
import './atlas-skeleton.ts';
import './atlas-badge.ts';
import './atlas-tab-bar.ts';

// Form controls (Batch 1)
import './atlas-checkbox.ts';
import './atlas-radio.ts';
import './atlas-switch.ts';
import './atlas-textarea.ts';
import './atlas-number-input.ts';
import './atlas-search-input.ts';
import './atlas-select.ts';
import './atlas-slider.ts';
import './atlas-date-picker.ts';
import './atlas-file-upload.ts';

// Form field wrapper (Light DOM)
import './atlas-form-field.ts';

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

// C1 primitives (Light DOM)
import './atlas-card.ts';
import './atlas-divider.ts';
import './atlas-grid.ts';
import './atlas-label.ts';
import './atlas-code.ts';
// Stub only — Monaco is dynamic-imported by the stub on first connect.
import './atlas-code-editor.ts';
import './atlas-kbd.ts';
import './atlas-link.ts';
import './atlas-scroll-area.ts';
import './atlas-spinner.ts';

// C2 primitives
import './atlas-tabs.ts';
import './atlas-segmented-control.ts';
import './atlas-accordion.ts';
import './atlas-empty-state.ts';
import './atlas-alert.ts';

// C3 primitives (overlays + ephemera)
import './atlas-tooltip.ts';
import './atlas-dialog.ts';
import './atlas-drawer.ts';
import './atlas-toast.ts';
import './atlas-command-palette.ts';

// Data display
import './atlas-stat.ts';
import './atlas-timeline.ts';
import './atlas-timeline-item.ts';

// Control composites
import './atlas-split-button.ts';
import './atlas-toggle-group.ts';
import './atlas-toggle-group-item.ts';
