import { AtlasElement, effect } from '@atlas/core';

/**
 * <atlas-chart-config-panel>
 *   <atlas-chart-config-field field="type" label="Chart type"
 *                             options="line,area,bar,stacked-bar"></atlas-chart-config-field>
 *   <atlas-chart-config-field field="aggregation" label="Aggregation"
 *                             options="sum,avg,count"></atlas-chart-config-field>
 * </atlas-chart-config-panel>
 *
 * Each `<atlas-chart-config-field>` is a labelled `<select>` bound to
 * `store.config[field]`. Changing it commits `setConfig`. The field
 * gets `name="config" key={field}` so its testid is auto-generated.
 */
class AtlasChartConfigPanel extends AtlasElement {
  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'group');
  }
}

AtlasElement.define('atlas-chart-config-panel', AtlasChartConfigPanel);

class AtlasChartConfigField extends AtlasElement {
  constructor() {
    super();
    this._effectDispose = null;
  }

  static get observedAttributes() { return ['field', 'options', 'label']; }

  get field() { return this.getAttribute('field'); }
  get label() { return this.getAttribute('label') ?? this.field; }
  get _options() {
    const raw = this.getAttribute('options') ?? '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }

  get _card() {
    return this.closest('atlas-chart-card');
  }

  connectedCallback() {
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

  disconnectedCallback() {
    this._effectDispose?.();
    this._effectDispose = null;
    super.disconnectedCallback?.();
  }

  _render(store) {
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
    const current = store?.config?.[this.field];
    for (const opt of this._options) {
      const el = document.createElement('option');
      el.value = opt;
      el.textContent = opt;
      if (String(current) === opt) el.selected = true;
      select.appendChild(el);
    }
    select.addEventListener('change', () => {
      store?.commit('setConfig', { field: this.field, value: select.value });
    });
    wrap.appendChild(select);
    this.appendChild(wrap);
  }
}

AtlasElement.define('atlas-chart-config-field', AtlasChartConfigField);

export { AtlasChartConfigPanel, AtlasChartConfigField };
