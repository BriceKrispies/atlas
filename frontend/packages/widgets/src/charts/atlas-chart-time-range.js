import { AtlasElement, effect } from '@atlas/core';

const DEFAULT_PRESETS = [
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
 * `name="range" key={preset}` so its testid is auto-generated. Click
 * commits `setTimeRange` on the owning `atlas-chart-card`'s store.
 *
 * `all` is special: it clears the active time range.
 */
class AtlasChartTimeRange extends AtlasElement {
  constructor() {
    super();
    this._effectDispose = null;
  }

  static get observedAttributes() { return ['presets']; }

  get _card() {
    return this.closest('atlas-chart-card');
  }

  get _presets() {
    const attr = this.getAttribute('presets');
    if (!attr) return DEFAULT_PRESETS;
    const allowed = new Set(attr.split(',').map((s) => s.trim()));
    return DEFAULT_PRESETS.filter((p) => allowed.has(p.key));
  }

  connectedCallback() {
    super.connectedCallback();
    const card = this._card;
    if (card?.store) {
      this._effectDispose = effect(() => this._render(card.store));
    } else {
      this._render(null);
    }
  }

  disconnectedCallback() {
    this._effectDispose?.();
    this._effectDispose = null;
    super.disconnectedCallback?.();
  }

  _render(store) {
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
