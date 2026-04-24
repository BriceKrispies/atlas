/**
 * sandbox.heading — a widget that renders a single <atlas-heading>.
 *
 * Wraps the design-system primitive so the page editor can place it as a
 * first-class widget. Config shape:
 *   { level: 1..6, text: string }
 */

import { AtlasElement } from '@atlas/core';

export interface HeadingWidgetConfig {
  level: number;
  text: string;
}

export const manifest = {
  widgetId: 'sandbox.heading',
  version: '0.1.0',
  displayName: 'Heading',
  description: 'A heading at levels 1 through 6.',
  configSchema: 'ui.widget.sandbox.heading.config.v1',
  isolation: 'inline',
  capabilities: [],
  provides: { topics: [] },
  consumes: { topics: [] },
  deferredStates: [
    { state: 'loading', reason: 'No async data.' },
    { state: 'empty', reason: 'Empty text renders blank heading.' },
    { state: 'validationError', reason: 'No user input; config is validated by host.' },
    { state: 'backendError', reason: 'No backend calls.' },
    { state: 'unauthorized', reason: 'No permission-gated content.' },
  ],
} as const;

export class HeadingWidget extends AtlasElement {
  private _config: Partial<HeadingWidgetConfig> = {};

  set config(value: Partial<HeadingWidgetConfig> | null | undefined) {
    this._config = value ?? {};
    if (this.isConnected) this._rerender();
  }
  get config(): Partial<HeadingWidgetConfig> {
    return this._config;
  }

  override connectedCallback(): void {
    super.connectedCallback?.();
    this._rerender();
  }

  private _rerender(): void {
    this.textContent = '';
    const level = clampLevel(this._config?.level);
    const text = String(this._config?.text ?? '');
    const h = document.createElement('atlas-heading');
    h.setAttribute('level', String(level));
    h.textContent = text;
    this.appendChild(h);
  }
}

function clampLevel(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  if (n < 1) return 1;
  if (n > 6) return 6;
  return Math.round(n);
}

AtlasElement.define('sandbox-widget-heading', HeadingWidget);

export const element = HeadingWidget;
