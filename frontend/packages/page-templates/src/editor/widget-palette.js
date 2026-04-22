/**
 * <widget-palette> — lists every widget in the registry that could be placed
 * into SOME region of the active template. Each entry is:
 *   - a focusable atlas-button
 *   - a DnD subsystem drag source (Pointer Events, not HTML5 DnD)
 *   - uniquely named `palette-chip-{widgetId}` so Playwright can select
 *     it via the auto-testid `widget-palette.palette-chip-{widgetId}`
 *
 * Interaction:
 *   - click / keyboard Enter  → calls host.onChipSelect({widgetId})
 *                               (host sets its "picked chip" state; next
 *                                zone click commits via editor.add)
 *   - pointer drag            → registered with the DnD subsystem by
 *                                edit-mount. Drop on a zone commits via
 *                                editor.add.
 *
 * Constitutional rules:
 *   C2: test-ids auto-computed from `name` attribute + AtlasSurface ancestor.
 *   C11: no raw HTML — only atlas-* elements.
 */

import { AtlasElement, AtlasSurface, html } from '@atlas/core';

import { computeValidTargets } from '../drop-zones.js';

export class WidgetPaletteElement extends AtlasSurface {
  static surfaceId = 'widget-palette';
  constructor() {
    super();
    /** @type {object | null} */
    this._widgetRegistry = null;
    /** @type {object | null} */
    this._pageDoc = null;
    /** @type {object | null} */
    this._templateManifest = null;
    /** @type {((arg: { widgetId: string }) => void) | null} */
    this.onChipSelect = null;
    /** @type {((arg: { widgetId: string, region?: string, index?: number }) => void) | null} */
    this.onChipActivate = null;
  }

  set widgetRegistry(value) {
    this._widgetRegistry = value;
    if (this.isConnected) this._rerender();
  }
  get widgetRegistry() {
    return this._widgetRegistry;
  }

  set pageDoc(value) {
    this._pageDoc = value;
    if (this.isConnected) this._rerender();
  }
  get pageDoc() {
    return this._pageDoc;
  }

  set templateManifest(value) {
    this._templateManifest = value;
    if (this.isConnected) this._rerender();
  }
  get templateManifest() {
    return this._templateManifest;
  }

  connectedCallback() {
    this._applyTestId();
    this._rerender();
    this.onMount();
  }

  disconnectedCallback() {
    this.onUnmount();
    this.textContent = '';
  }

  render() {
    // Imperative rerender is driven by _rerender; base-class effect not used.
  }

  _placeableWidgets() {
    const reg = this._widgetRegistry;
    const tpl = this._templateManifest;
    if (!reg || typeof reg.list !== 'function' || !tpl) return [];
    const doc = this._pageDoc ?? { regions: {} };
    const out = [];
    for (const summary of reg.list()) {
      const result = computeValidTargets(summary.widgetId, doc, tpl, reg, null);
      const anyInsertable = result.validRegions.some((r) =>
        r.canInsertAt.some((b) => b === true),
      );
      if (anyInsertable) {
        out.push(summary);
      }
    }
    return out;
  }

  _rerender() {
    this.textContent = '';

    const widgets = this._placeableWidgets();

    const fragment = html`
      <atlas-box padding="sm" name="widget-palette-box">
        <atlas-stack gap="sm">
          <atlas-heading level="3">Add widget</atlas-heading>
          <atlas-stack gap="xs" data-palette-list>
            ${widgets.length === 0
              ? html`<atlas-text variant="muted" name="palette-empty"
                  >No widgets fit this template.</atlas-text
                >`
              : ''}
          </atlas-stack>
        </atlas-stack>
      </atlas-box>
    `;
    this.appendChild(fragment);

    const list = this.querySelector('[data-palette-list]');
    for (const summary of widgets) {
      const btn = document.createElement('atlas-button');
      btn.setAttribute('name', `palette-chip-${summary.widgetId}`);
      btn.setAttribute('data-palette-chip', '');
      btn.setAttribute('data-widget-id', summary.widgetId);
      btn.setAttribute('size', 'sm');
      btn.setAttribute('variant', 'ghost');
      btn.textContent = summary.displayName ?? summary.widgetId;

      btn.addEventListener('click', () => {
        if (typeof this.onChipSelect === 'function') {
          this.onChipSelect({ widgetId: summary.widgetId });
        }
      });
      btn.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
          ev.preventDefault();
          if (typeof this.onChipSelect === 'function') {
            this.onChipSelect({ widgetId: summary.widgetId });
          }
        }
      });
      list?.appendChild(btn);
    }
  }
}

if (typeof customElements !== 'undefined') {
  AtlasElement.define('widget-palette', WidgetPaletteElement);
}
