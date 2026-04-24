/**
 * sandbox.data-table — widget wrapper around <atlas-data-table>.
 *
 * For v0 the config carries `columns` (as-is property) and either
 * `data` (inline array) or a `resourceType` string. A future revision
 * wires a backend.query capability so data can be loaded live.
 */

import { AtlasElement } from '@atlas/core';
import { arrayDataSource } from '@atlas/widgets';

export const manifest = {
  widgetId: 'sandbox.data-table',
  version: '0.1.0',
  displayName: 'Data table',
  description: 'Paginated, sortable, filterable table.',
  configSchema: 'ui.widget.sandbox.data-table.config.v1',
  isolation: 'inline',
  capabilities: [],
  provides: { topics: [] },
  consumes: { topics: [] },
  deferredStates: [
    { state: 'loading', reason: 'Synthesized from inline data; loading path not exercised in sandbox.' },
    { state: 'backendError', reason: 'No backend calls.' },
    { state: 'unauthorized', reason: 'No permission-gated content.' },
  ],
};

const DENSITIES = ['compact', 'cozy', 'comfortable'];
const SELECTIONS = ['none', 'single', 'multi'];

export class DataTableWidget extends AtlasElement {
  constructor() {
    super();
    this._config = {};
  }

  set config(value) {
    this._config = value ?? {};
    if (this.isConnected) this._rerender();
  }
  get config() { return this._config; }

  connectedCallback() {
    super.connectedCallback?.();
    this._rerender();
  }

  _rerender() {
    this.textContent = '';
    const table = document.createElement('atlas-data-table');
    const cfg = this._config ?? {};

    if (cfg.label) table.setAttribute('label', String(cfg.label));
    if (Number.isFinite(cfg.pageSize)) table.setAttribute('page-size', String(cfg.pageSize));
    if (DENSITIES.includes(cfg.density)) table.setAttribute('density', cfg.density);
    if (SELECTIONS.includes(cfg.selection)) table.setAttribute('selection', cfg.selection);
    if (cfg.rowKey) table.setAttribute('row-key', String(cfg.rowKey));
    if (cfg.resourceType) table.setAttribute('resource-type', String(cfg.resourceType));
    if (cfg.emptyHeading) table.setAttribute('empty-heading', String(cfg.emptyHeading));
    if (cfg.emptyBody) table.setAttribute('empty-body', String(cfg.emptyBody));

    const columns = Array.isArray(cfg.columns) ? cfg.columns : [];
    table.columns = columns;

    const rows = Array.isArray(cfg.data) ? cfg.data : [];
    table.dataSource = arrayDataSource(rows);

    this.appendChild(table);
  }
}

AtlasElement.define('sandbox-widget-data-table', DataTableWidget);

export const element = DataTableWidget;
