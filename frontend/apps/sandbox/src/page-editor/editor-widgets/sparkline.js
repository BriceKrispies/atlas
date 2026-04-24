/**
 * sandbox.sparkline — widget wrapper around <atlas-sparkline>.
 */

import { AtlasElement } from '@atlas/core';

export const manifest = {
  widgetId: 'sandbox.sparkline',
  version: '0.1.0',
  displayName: 'Sparkline',
  description: 'Inline compact line chart.',
  configSchema: 'ui.widget.sandbox.sparkline.config.v1',
  isolation: 'inline',
  capabilities: [],
  provides: { topics: [] },
  consumes: { topics: [] },
  deferredStates: [
    { state: 'loading', reason: 'Static; no async load.' },
    { state: 'empty', reason: 'Empty values renders blank.' },
    { state: 'validationError', reason: 'No user input.' },
    { state: 'backendError', reason: 'No backend calls.' },
    { state: 'unauthorized', reason: 'No permission-gated content.' },
  ],
};

export class SparklineWidget extends AtlasElement {
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
    const el = document.createElement('atlas-sparkline');
    const cfg = this._config ?? {};
    if (cfg.values != null && cfg.values !== '') {
      el.setAttribute('values', String(cfg.values));
    }
    if (cfg.color) el.setAttribute('color', String(cfg.color));
    if (cfg.label) el.setAttribute('label', String(cfg.label));
    if (cfg.showLastPoint) el.setAttribute('show-last-point', '');
    this.appendChild(el);
  }
}

AtlasElement.define('sandbox-widget-sparkline', SparklineWidget);

export const element = SparklineWidget;
