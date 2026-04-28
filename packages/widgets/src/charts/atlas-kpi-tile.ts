import { AtlasElement } from '@atlas/core';

/**
 * <atlas-kpi-tile> — big-number summary tile.
 */
class AtlasKpiTile extends AtlasElement {
  static override get observedAttributes(): string[] {
    return ['value', 'label', 'trend', 'trend-label', 'unit', 'sparkline-values'];
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'group');
    this._render();
  }

  override attributeChangedCallback(): void {
    this._render();
  }

  _render(): void {
    this.textContent = '';
    const label = this.getAttribute('label') ?? '';
    const value = this.getAttribute('value') ?? '';
    const unit = this.getAttribute('unit') ?? '';
    const trend = this.getAttribute('trend') ?? '';
    const trendLabel = this.getAttribute('trend-label') ?? '';
    const spark = this.getAttribute('sparkline-values') ?? '';

    if (label) {
      const l = document.createElement('div');
      l.dataset['role'] = 'label';
      l.textContent = label;
      this.appendChild(l);
    }

    const v = document.createElement('div');
    v.dataset['role'] = 'value';
    v.textContent = unit ? `${value}${unit.startsWith(' ') ? unit : ' ' + unit}` : value;
    this.appendChild(v);

    if (trend || trendLabel) {
      const t = document.createElement('div');
      t.dataset['role'] = 'trend';
      t.dataset['trend'] = trend || 'flat';
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

function arrow(trend: string): string {
  if (trend === 'up') return '▲';
  if (trend === 'down') return '▼';
  return '—';
}

AtlasElement.define('atlas-kpi-tile', AtlasKpiTile);
