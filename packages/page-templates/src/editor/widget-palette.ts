/**
 * <widget-palette> — lists every widget in the registry that could be placed
 * into SOME region of the active template. Each entry is:
 *   - a focusable atlas-button
 *   - a DnD subsystem drag source (Pointer Events, not HTML5 DnD)
 *   - uniquely named `palette-chip-{widgetId}` so Playwright can select
 *     it via the auto-testid `widget-palette.palette-chip-{widgetId}`
 */

import { AtlasElement, AtlasSurface, html } from '@atlas/core';

import { computeValidTargets, type WidgetRegistryLike } from '../drop-zones.ts';
import type { PageDocument } from '../page-store.ts';
import type { TemplateManifest } from '../registry.ts';

export interface ChipSelectArg {
  widgetId: string;
}

export interface ChipActivateArg {
  widgetId: string;
  region?: string;
  index?: number;
}

interface WidgetSummary {
  widgetId: string;
  displayName?: string;
  [k: string]: unknown;
}

export class WidgetPaletteElement extends AtlasSurface {
  static override surfaceId = 'widget-palette';

  private _widgetRegistry: WidgetRegistryLike | null = null;
  private _pageDoc: PageDocument | null = null;
  private _templateManifest: TemplateManifest | null = null;
  onChipSelect: ((arg: ChipSelectArg) => void) | null = null;
  onChipActivate: ((arg: ChipActivateArg) => void) | null = null;

  set widgetRegistry(value: WidgetRegistryLike | null) {
    this._widgetRegistry = value;
    if (this.isConnected) this._rerender();
  }
  get widgetRegistry(): WidgetRegistryLike | null {
    return this._widgetRegistry;
  }

  set pageDoc(value: PageDocument | null) {
    this._pageDoc = value;
    if (this.isConnected) this._rerender();
  }
  get pageDoc(): PageDocument | null {
    return this._pageDoc;
  }

  set templateManifest(value: TemplateManifest | null) {
    this._templateManifest = value;
    if (this.isConnected) this._rerender();
  }
  get templateManifest(): TemplateManifest | null {
    return this._templateManifest;
  }

  override connectedCallback(): void {
    (this as unknown as { _applyTestId: () => void })._applyTestId();
    this._rerender();
    this.onMount();
  }

  override disconnectedCallback(): void {
    this.onUnmount();
    this.textContent = '';
  }

  override render(): void {
    // Imperative rerender is driven by _rerender; base-class effect not used.
  }

  private _placeableWidgets(): WidgetSummary[] {
    const reg = this._widgetRegistry;
    const tpl = this._templateManifest;
    if (!reg || typeof reg.list !== 'function' || !tpl) return [];
    const doc = this._pageDoc ?? ({ regions: {} } as PageDocument);
    const out: WidgetSummary[] = [];
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

  private _rerender(): void {
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
      btn.addEventListener('keydown', (ev: KeyboardEvent) => {
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
