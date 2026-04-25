/**
 * sandbox.text — a widget that renders a single <atlas-text>.
 * Config: { content, variant?, block? }
 */

import { AtlasElement } from '@atlas/core';

export type TextWidgetVariant = 'body' | 'muted' | 'medium' | 'error' | 'small' | 'mono';

export interface TextWidgetConfig {
  content: string;
  variant?: TextWidgetVariant;
  block?: boolean;
}

const VARIANTS: readonly TextWidgetVariant[] = ['body', 'muted', 'medium', 'error', 'small', 'mono'];

export const manifest = {
  widgetId: 'sandbox.text',
  version: '0.1.0',
  displayName: 'Text',
  description: 'A block of text at one of the standard variants.',
  configSchema: 'ui.widget.sandbox.text.config.v1',
  isolation: 'inline',
  capabilities: [],
  provides: { topics: [] },
  consumes: { topics: [] },
  deferredStates: [
    { state: 'loading', reason: 'No async data.' },
    { state: 'empty', reason: 'Empty content renders nothing.' },
    { state: 'validationError', reason: 'No user input.' },
    { state: 'backendError', reason: 'No backend calls.' },
    { state: 'unauthorized', reason: 'No permission-gated content.' },
  ],
} as const;

export class TextWidget extends AtlasElement {
  private _config: Partial<TextWidgetConfig> = {};

  set config(value: Partial<TextWidgetConfig> | null | undefined) {
    this._config = value ?? {};
    if (this.isConnected) this._rerender();
  }
  get config(): Partial<TextWidgetConfig> {
    return this._config;
  }

  override connectedCallback(): void {
    super.connectedCallback?.();
    this._rerender();
  }

  private _rerender(): void {
    this.textContent = '';
    const content = String(this._config?.content ?? '');
    const rawVariant = this._config?.variant;
    const variant: TextWidgetVariant =
      rawVariant && VARIANTS.includes(rawVariant) ? rawVariant : 'body';
    const block = Boolean(this._config?.block);
    const el = document.createElement('atlas-text');
    el.setAttribute('variant', variant);
    if (block) el.setAttribute('block', '');
    el.textContent = content;
    this.appendChild(el);
  }
}

AtlasElement.define('sandbox-widget-text', TextWidget);

export const element = TextWidget;
