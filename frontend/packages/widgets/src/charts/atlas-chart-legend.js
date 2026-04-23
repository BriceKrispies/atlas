import { AtlasElement } from '@atlas/core';

/**
 * <atlas-chart-legend> — flex row of { swatch, label } items.
 *
 * Set `entries = [{ label, color }, ...]` as a property; the element
 * renders a swatch + label list.
 */
class AtlasChartLegend extends AtlasElement {
  constructor() {
    super();
    this._entries = [];
  }

  static get observedAttributes() { return []; }

  get entries() { return this._entries.slice(); }
  set entries(list) {
    this._entries = Array.isArray(list) ? list.slice() : [];
    this._render();
  }

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'list');
    this._render();
  }

  _render() {
    this.textContent = '';
    for (const entry of this._entries) {
      const item = document.createElement('span');
      item.setAttribute('role', 'listitem');
      item.dataset.role = 'item';

      const swatch = document.createElement('span');
      swatch.setAttribute('aria-hidden', 'true');
      swatch.dataset.role = 'swatch';
      if (entry.color) swatch.style.background = entry.color;
      item.appendChild(swatch);

      const label = document.createTextNode(entry.label ?? '');
      item.appendChild(label);
      this.appendChild(item);
    }
  }
}

AtlasElement.define('atlas-chart-legend', AtlasChartLegend);
