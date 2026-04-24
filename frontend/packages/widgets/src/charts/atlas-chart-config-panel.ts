import { AtlasElement, effect, type EffectCleanup } from '@atlas/core';
import type { AtlasChartCard } from './atlas-chart-card.ts';
import type { ChartStateStore } from './chart-state.ts';

/**
 * <atlas-chart-config-panel>
 *   <atlas-chart-config-field field="type" label="Chart type"
 *                             options="line,area,bar,stacked-bar"></atlas-chart-config-field>
 *   <atlas-chart-config-field field="aggregation" label="Aggregation"
 *                             options="sum,avg,count"></atlas-chart-config-field>
 * </atlas-chart-config-panel>
 */
class AtlasChartConfigPanel extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'group');
  }
}

AtlasElement.define('atlas-chart-config-panel', AtlasChartConfigPanel);

class AtlasChartConfigField extends AtlasElement {
  _effectDispose: EffectCleanup | null = null;

  static override get observedAttributes(): string[] { return ['field', 'options', 'label']; }

  get field(): string | null { return this.getAttribute('field'); }
  get label(): string { return this.getAttribute('label') ?? this.field ?? ''; }
  get _options(): string[] {
    const raw = this.getAttribute('options') ?? '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }

  get _card(): AtlasChartCard | null {
    return this.closest('atlas-chart-card') as AtlasChartCard | null;
  }

  override connectedCallback(): void {
    this.setAttribute('name', 'config');
    if (this.field) this.setAttribute('key', this.field);
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
    const wrap = document.createElement('label');
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.gap = 'var(--atlas-space-xs)';

    const caption = document.createElement('span');
    caption.textContent = this.label;
    wrap.appendChild(caption);

    const select = document.createElement('select');
    select.setAttribute('aria-label', this.label);
    const current = this.field ? store?.config?.[this.field] : undefined;
    for (const opt of this._options) {
      const el = document.createElement('option');
      el.value = opt;
      el.textContent = opt;
      if (String(current) === opt) el.selected = true;
      select.appendChild(el);
    }
    select.addEventListener('change', () => {
      if (!this.field) return;
      store?.commit('setConfig', { field: this.field, value: select.value });
    });
    wrap.appendChild(select);
    this.appendChild(wrap);
  }
}

AtlasElement.define('atlas-chart-config-field', AtlasChartConfigField);

export { AtlasChartConfigPanel, AtlasChartConfigField };
