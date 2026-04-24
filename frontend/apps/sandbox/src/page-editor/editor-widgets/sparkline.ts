/**
 * sandbox.sparkline — widget wrapper around <atlas-sparkline>.
 */

import { AtlasElement } from '@atlas/core';

export interface SparklineWidgetConfig {
  values: string;
  color?: string;
  label?: string;
  showLastPoint?: boolean;
}

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
} as const;

export class SparklineWidget extends AtlasElement {
  private _config: Partial<SparklineWidgetConfig> = {};

  set config(value: Partial<SparklineWidgetConfig> | null | undefined) {
    this._config = value ?? {};
    if (this.isConnected) this._rerender();
  }
  get config(): Partial<SparklineWidgetConfig> {
    return this._config;
  }

  override connectedCallback(): void {
    super.connectedCallback?.();
    this._rerender();
  }

  private _rerender(): void {
    this.textContent = '';
    const el = document.createElement('atlas-sparkline');
    const cfg: Partial<SparklineWidgetConfig> = this._config ?? {};
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
