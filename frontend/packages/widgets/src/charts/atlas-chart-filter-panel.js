import { AtlasElement, effect } from '@atlas/core';

/**
 * <atlas-chart-filter-panel>
 *   <atlas-chart-filter field="region" op="=" label="Region">
 *     <option value="NA">North America</option>
 *     <option value="EU">Europe</option>
 *     <option value="APAC">APAC</option>
 *   </atlas-chart-filter>
 * </atlas-chart-filter-panel>
 *
 * Each `<atlas-chart-filter>` is a named control with `name="filter"
 * key={field}`. Changing the value commits `setFilter`; selecting the
 * blank option commits `clearFilter`.
 */
class AtlasChartFilterPanel extends AtlasElement {
  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'group');
  }
}

AtlasElement.define('atlas-chart-filter-panel', AtlasChartFilterPanel);

class AtlasChartFilter extends AtlasElement {
  constructor() {
    super();
    this._effectDispose = null;
  }

  static get observedAttributes() { return ['field', 'op', 'label']; }

  get field() { return this.getAttribute('field'); }
  get op() { return this.getAttribute('op') ?? '='; }
  get label() { return this.getAttribute('label') ?? this.field; }

  get _card() {
    return this.closest('atlas-chart-card');
  }

  connectedCallback() {
    // Set name/key BEFORE super so _applyTestId picks them up.
    this.setAttribute('name', 'filter');
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
    const options = [...this.querySelectorAll('option')].map((o) => ({
      value: o.value,
      label: o.textContent,
    }));
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
    const active = store?.filters?.find((f) => f.field === this.field);

    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Any';
    select.appendChild(blank);

    for (const opt of options) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      if (active && String(active.value) === String(opt.value)) {
        el.selected = true;
      }
      select.appendChild(el);
    }

    select.addEventListener('change', () => {
      if (!store) return;
      const v = select.value;
      if (v === '') {
        store.commit('clearFilter', { field: this.field });
      } else {
        store.commit('setFilter', { field: this.field, op: this.op, value: v });
      }
    });

    wrap.appendChild(select);
    this.appendChild(wrap);
  }
}

AtlasElement.define('atlas-chart-filter', AtlasChartFilter);

export { AtlasChartFilterPanel, AtlasChartFilter };
