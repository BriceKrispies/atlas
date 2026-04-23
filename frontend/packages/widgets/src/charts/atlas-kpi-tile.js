import { AtlasElement } from '@atlas/core';

/**
 * <atlas-kpi-tile> — big-number summary tile.
 *
 * Attributes:
 *   - value  : the headline string (numbers accepted; not formatted).
 *   - label  : caption rendered above the value.
 *   - trend  : 'up' | 'down' | 'flat' — colorizes the trend badge.
 *   - trend-label : display text for the trend (e.g. "+5.2% vs. last week").
 *   - unit   : appended to the value (e.g. "%", "req/s").
 *   - sparkline-values : optional comma-separated series; when set,
 *     renders an inline <atlas-sparkline> below the value.
 */
class AtlasKpiTile extends AtlasElement {
  static get observedAttributes() {
    return ['value', 'label', 'trend', 'trend-label', 'unit', 'sparkline-values'];
  }

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'group');
    this._render();
  }

  attributeChangedCallback() {
    this._render();
  }

  _render() {
    this.textContent = '';
    const label = this.getAttribute('label') ?? '';
    const value = this.getAttribute('value') ?? '';
    const unit = this.getAttribute('unit') ?? '';
    const trend = this.getAttribute('trend') ?? '';
    const trendLabel = this.getAttribute('trend-label') ?? '';
    const spark = this.getAttribute('sparkline-values') ?? '';

    if (label) {
      const l = document.createElement('div');
      l.dataset.role = 'label';
      l.textContent = label;
      this.appendChild(l);
    }

    const v = document.createElement('div');
    v.dataset.role = 'value';
    v.textContent = unit ? `${value}${unit.startsWith(' ') ? unit : ' ' + unit}` : value;
    this.appendChild(v);

    if (trend || trendLabel) {
      const t = document.createElement('div');
      t.dataset.role = 'trend';
      t.dataset.trend = trend || 'flat';
      t.setAttribute('aria-label', trendLabel || `Trend ${trend}`);
      t.textContent = `${arrow(trend)} ${trendLabel}`.trim();
      this.appendChild(t);
    }

    if (spark) {
      const s = document.createElement('atlas-sparkline');
      s.setAttribute('values', spark);
      s.setAttribute('show-last-point', '');
      this.appendChild(s);
    }
  }
}

function arrow(trend) {
  if (trend === 'up') return '▲';
  if (trend === 'down') return '▼';
  return '—';
}

AtlasElement.define('atlas-kpi-tile', AtlasKpiTile);
