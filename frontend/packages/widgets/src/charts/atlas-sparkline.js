import { AtlasElement } from '@atlas/core';
import { paletteColor } from './color-palette.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * <atlas-sparkline> — inline one-line chart without axes or legend.
 *
 * Accepted inputs (property `values` or comma-separated `values` attribute):
 *   - number[]
 *   - [{x, y}, ...] (x is ignored; order is used)
 *
 * Attributes:
 *   - values : comma-separated numbers (e.g. "1,3,5,4,7")
 *   - color  : CSS color; defaults to --atlas-chart-color-1
 *   - label  : accessible name (role="img")
 *   - show-last-point : presence → renders a dot at the trailing value
 */
class AtlasSparkline extends AtlasElement {
  static get observedAttributes() {
    return ['values', 'color', 'label', 'show-last-point'];
  }

  constructor() {
    super();
    this._values = [];
  }

  get values() { return this._values.slice(); }
  set values(next) {
    this._values = normalize(next);
    this._render();
  }

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'img');
    const attr = this.getAttribute('values');
    if (attr && this._values.length === 0) this._values = parseCsv(attr);
    this._render();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal) return;
    if (name === 'values') this._values = parseCsv(newVal);
    this._render();
  }

  _render() {
    this.textContent = '';
    const label = this.getAttribute('label') ?? `Sparkline with ${this._values.length} points`;
    this.setAttribute('aria-label', label);

    const width = this.clientWidth || 96;
    const height = this.clientHeight || 24;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    const values = this._values;
    if (values.length < 2) {
      this.appendChild(svg);
      return;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = 1;
    const range = (max - min) || 1;
    const xStep = (width - pad * 2) / (values.length - 1);
    const color = this.getAttribute('color') || paletteColor(this, 1);

    const points = values.map((v, i) => [pad + i * xStep, height - pad - ((v - min) / range) * (height - pad * 2)]);
    const d = points.map(([x, y], i) => (i === 0 ? 'M' : 'L') + ` ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);

    if (this.hasAttribute('show-last-point')) {
      const [lx, ly] = points[points.length - 1];
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(lx));
      circle.setAttribute('cy', String(ly));
      circle.setAttribute('r', '2');
      circle.setAttribute('fill', color);
      svg.appendChild(circle);
    }

    this.appendChild(svg);
  }
}

function normalize(next) {
  if (!Array.isArray(next)) return [];
  const out = [];
  for (const item of next) {
    if (item == null) continue;
    if (typeof item === 'number') out.push(item);
    else if (typeof item === 'object' && item.y != null) out.push(Number(item.y));
    else {
      const n = Number(item);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out.filter((n) => Number.isFinite(n));
}

function parseCsv(str) {
  if (!str) return [];
  return str.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}

AtlasElement.define('atlas-sparkline', AtlasSparkline);
