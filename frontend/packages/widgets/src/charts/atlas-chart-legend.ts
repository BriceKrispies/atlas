import { AtlasElement, effect, type EffectCleanup } from '@atlas/core';
import type { AtlasChartCard } from './atlas-chart-card.ts';
import type { ChartStateStore } from './chart-state.ts';

interface LegendEntryInput {
  id?: string;
  label: string;
  color?: string;
}

interface RenderedEntry {
  id: string;
  label: string;
  color?: string;
  hidden: boolean;
  interactive: boolean;
}

/**
 * <atlas-chart-legend> — legend row. When used inside an
 * `<atlas-chart-card>` it reads series from the card's store and
 * toggles visibility via `commit('toggleSeries', ...)`.
 */
class AtlasChartLegend extends AtlasElement {
  _entries: LegendEntryInput[] = [];
  _effectDispose: EffectCleanup | null = null;
  _standalone: boolean = false;

  static override get observedAttributes(): string[] { return []; }

  get entries(): LegendEntryInput[] { return this._entries.slice(); }
  set entries(list: LegendEntryInput[]) {
    this._entries = Array.isArray(list) ? list.slice() : [];
    this._standalone = true;
    this._renderFlat();
  }

  get _card(): AtlasChartCard | null {
    return this.closest('atlas-chart-card') as AtlasChartCard | null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'list');

    const card = this._card;
    if (card && card.store) {
      this._effectDispose = effect(() => this._renderFromStore(card.store!));
    } else if (this._entries.length) {
      this._renderFlat();
    }
  }

  override disconnectedCallback(): void {
    this._effectDispose?.();
    this._effectDispose = null;
    super.disconnectedCallback?.();
  }

  _renderFromStore(store: ChartStateStore): void {
    const data = store.data;
    const hidden = new Set(store.hiddenSeries);
    const entries: RenderedEntry[] = [];
    if (data?.series) {
      data.series.forEach((s) => {
        const id = (s.id ?? s.name) as string;
        entries.push({
          id,
          label: s.name,
          ...(s.color != null ? { color: s.color } : {}),
          hidden: hidden.has(id),
          interactive: true,
        });
      });
    } else if (data?.slices) {
      data.slices.forEach((s) => {
        entries.push({
          id: s.label,
          label: s.label,
          ...(s.color != null ? { color: s.color } : {}),
          hidden: false,
          interactive: false,
        });
      });
    }
    this._renderEntries(entries);
  }

  _renderFlat(): void {
    this._renderEntries(
      this._entries.map((e): RenderedEntry => ({
        id: (e.id ?? e.label) as string,
        label: e.label,
        ...(e.color != null ? { color: e.color } : {}),
        hidden: false,
        interactive: false,
      })),
    );
  }

  _renderEntries(entries: RenderedEntry[]): void {
    this.textContent = '';
    const store = this._card?.store;

    for (const e of entries) {
      if (e.interactive) {
        const btn = document.createElement('atlas-button');
        btn.setAttribute('variant', 'ghost');
        btn.setAttribute('size', 'sm');
        btn.setAttribute('name', 'series');
        btn.setAttribute('key', String(e.id));
        btn.setAttribute('role', 'listitem');
        btn.setAttribute('aria-pressed', e.hidden ? 'false' : 'true');
        if (e.hidden) btn.dataset['hidden'] = 'true';
        btn.dataset['seriesId'] = e.id;
        btn.addEventListener('click', () => {
          store?.commit('toggleSeries', { seriesId: e.id, hidden: !e.hidden });
        });

        const swatch = document.createElement('span');
        swatch.setAttribute('aria-hidden', 'true');
        swatch.dataset['role'] = 'swatch';
        if (e.color) swatch.style.background = e.color;
        btn.appendChild(swatch);
        btn.appendChild(document.createTextNode(e.label ?? ''));
        this.appendChild(btn);
      } else {
        const row = document.createElement('span');
        row.setAttribute('role', 'listitem');
        row.dataset['role'] = 'item';
        row.dataset['seriesId'] = e.id;
        const swatch = document.createElement('span');
        swatch.setAttribute('aria-hidden', 'true');
        swatch.dataset['role'] = 'swatch';
        if (e.color) swatch.style.background = e.color;
        row.appendChild(swatch);
        row.appendChild(document.createTextNode(e.label ?? ''));
        this.appendChild(row);
      }
    }
  }
}

AtlasElement.define('atlas-chart-legend', AtlasChartLegend);
