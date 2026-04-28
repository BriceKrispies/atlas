import { AtlasElement, effect, type EffectCleanup } from '@atlas/core';
import type { AtlasChartCard } from './atlas-chart-card.ts';
import type { ChartStateStore } from './chart-state.ts';

interface TimeRangePreset {
  key: string;
  label: string;
}

const DEFAULT_PRESETS: ReadonlyArray<TimeRangePreset> = [
  { key: '1d', label: '1D' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: 'all', label: 'All' },
];

/**
 * <atlas-chart-time-range presets="1d,7d,30d,all">
 *
 * Row of preset buttons. Each preset is an `<atlas-button>` with
 * `name="range" key={preset}` so its testid is auto-generated.
 */
class AtlasChartTimeRange extends AtlasElement {
  _effectDispose: EffectCleanup | null = null;

  static override get observedAttributes(): string[] { return ['presets']; }

  get _card(): AtlasChartCard | null {
    return this.closest('atlas-chart-card') as AtlasChartCard | null;
  }

  get _presets(): ReadonlyArray<TimeRangePreset> {
    const attr = this.getAttribute('presets');
    if (!attr) return DEFAULT_PRESETS;
    const allowed = new Set(attr.split(',').map((s) => s.trim()));
    return DEFAULT_PRESETS.filter((p) => allowed.has(p.key));
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const card = this._card;
    if (card?.store) {
      this._effectDispose = effect(() => this._render(card.store));
    } else {
      this._render(null);
    }
  }

  override disconnectedCallback(): void {
    this._effectDispose?.();
    this._effectDispose = null;
    super.disconnectedCallback?.();
  }

  _render(store: ChartStateStore | null): void {
    this.textContent = '';
    const active = store?.timeRange?.preset ?? 'all';
    for (const preset of this._presets) {
      const btn = document.createElement('atlas-button');
      btn.setAttribute('variant', active === preset.key ? 'primary' : 'ghost');
      btn.setAttribute('size', 'sm');
      btn.setAttribute('name', 'range');
      btn.setAttribute('key', preset.key);
      btn.textContent = preset.label;
      btn.addEventListener('click', () => {
        if (preset.key === 'all') {
          store?.commit('setTimeRange', { preset: null, from: null, to: null });
        } else {
          store?.commit('setTimeRange', { preset: preset.key });
        }
      });
      this.appendChild(btn);
    }
  }
}

AtlasElement.define('atlas-chart-time-range', AtlasChartTimeRange);
