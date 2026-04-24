/**
 * sandbox.kpi-tile — widget wrapper around <atlas-kpi-tile>.
 */

import { AtlasElement } from '@atlas/core';

export interface KpiTileWidgetConfig {
  label?: string;
  value: string;
  unit?: string;
  trend?: 'up' | 'down' | 'flat' | '';
  trendLabel?: string;
  sparklineValues?: string;
}

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
} as const;

export class KpiTileWidget extends AtlasElement {
  private _config: Partial<KpiTileWidgetConfig> = {};

  set config(value: Partial<KpiTileWidgetConfig> | null | undefined) {
    this._config = value ?? {};
    if (this.isConnected) this._rerender();
  }
  get config(): Partial<KpiTileWidgetConfig> {
    return this._config;
  }

  override connectedCallback(): void {
    super.connectedCallback?.();
    this._rerender();
  }

  private _rerender(): void {
    this.textContent = '';
    const tile = document.createElement('atlas-kpi-tile');
    const cfg: Partial<KpiTileWidgetConfig> = this._config ?? {};
    setAttr(tile, 'label', cfg.label);
    setAttr(tile, 'value', cfg.value);
    setAttr(tile, 'unit', cfg.unit);
    setAttr(tile, 'trend', cfg.trend);
    setAttr(tile, 'trend-label', cfg.trendLabel);
    setAttr(tile, 'sparkline-values', cfg.sparklineValues);
    this.appendChild(tile);
  }
}

function setAttr(el: Element, name: string, value: unknown): void {
  if (value == null || value === '') return;
  el.setAttribute(name, String(value));
}

AtlasElement.define('sandbox-widget-kpi-tile', KpiTileWidget);

export const element = KpiTileWidget;
