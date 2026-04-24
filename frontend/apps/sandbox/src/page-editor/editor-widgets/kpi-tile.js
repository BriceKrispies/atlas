/**
 * sandbox.kpi-tile — widget wrapper around <atlas-kpi-tile>.
 */

import { AtlasElement } from '@atlas/core';

export const manifest = {
  widgetId: 'sandbox.kpi-tile',
  version: '0.1.0',
  displayName: 'KPI tile',
  description: 'Big-number summary with optional trend and inline sparkline.',
  configSchema: 'ui.widget.sandbox.kpi-tile.config.v1',
  isolation: 'inline',
  capabilities: [],
  provides: { topics: [] },
  consumes: { topics: [] },
  deferredStates: [
    { state: 'loading', reason: 'Static display; no async load.' },
    { state: 'empty', reason: 'Empty value still renders tile.' },
    { state: 'validationError', reason: 'No user input.' },
    { state: 'backendError', reason: 'No backend calls.' },
    { state: 'unauthorized', reason: 'No permission-gated content.' },
  ],
};

export class KpiTileWidget extends AtlasElement {
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
    const tile = document.createElement('atlas-kpi-tile');
    const cfg = this._config ?? {};
    setAttr(tile, 'label', cfg.label);
    setAttr(tile, 'value', cfg.value);
    setAttr(tile, 'unit', cfg.unit);
    setAttr(tile, 'trend', cfg.trend);
    setAttr(tile, 'trend-label', cfg.trendLabel);
    setAttr(tile, 'sparkline-values', cfg.sparklineValues);
    this.appendChild(tile);
  }
}

function setAttr(el, name, value) {
  if (value == null || value === '') return;
  el.setAttribute(name, String(value));
}

AtlasElement.define('sandbox-widget-kpi-tile', KpiTileWidget);

export const element = KpiTileWidget;
