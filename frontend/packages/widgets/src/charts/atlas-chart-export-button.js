import { AtlasElement } from '@atlas/core';

/**
 * <atlas-chart-export-button format="csv">
 *
 * Single-format export trigger. `format` defaults to `csv`; use `png`
 * for image export. `name="export" key={format}` → auto testid.
 *
 * Clicking commits `requestExport`. The card consumer is responsible
 * for actually producing/downloading the file — the commit records
 * the intent for tests to assert.
 */
class AtlasChartExportButton extends AtlasElement {
  static get observedAttributes() { return ['format', 'label']; }

  get format() { return this.getAttribute('format') ?? 'csv'; }
  get label() { return this.getAttribute('label') ?? `Export ${this.format.toUpperCase()}`; }

  get _card() {
    return this.closest('atlas-chart-card');
  }

  connectedCallback() {
    this.setAttribute('name', 'export');
    this.setAttribute('key', this.format);
    super.connectedCallback();
    this._render();
  }

  _render() {
    this.textContent = '';
    const btn = document.createElement('atlas-button');
    btn.setAttribute('variant', 'ghost');
    btn.setAttribute('size', 'sm');
    btn.textContent = this.label;
    btn.addEventListener('click', () => {
      this._card?.store?.commit('requestExport', { format: this.format });
    });
    this.appendChild(btn);
  }
}

AtlasElement.define('atlas-chart-export-button', AtlasChartExportButton);
