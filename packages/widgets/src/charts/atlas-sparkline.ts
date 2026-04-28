import { AtlasElement } from '@atlas/core';
import { paletteColor } from './color-palette.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * <atlas-sparkline> — inline one-line chart without axes or legend.
 */
class AtlasSparkline extends AtlasElement {
  static override get observedAttributes(): string[] {
    return ['values', 'color', 'label', 'show-last-point'];
  }

  _values: number[] = [];

  get values(): number[] { return this._values.slice(); }
  set values(next: unknown) {
    this._values = normalize(next);
    this._render();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'img');
    const attr = this.getAttribute('values');
    if (attr && this._values.length === 0) this._values = parseCsv(attr);
    this._render();
  }

  override attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (oldVal === newVal) return;
    if (name === 'values') this._values = parseCsv(newVal);
    this._render();
  }

  _render(): void {
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

    const points: Array<[number, number]> = values.map((v, i) => [
      pad + i * xStep,
      height - pad - ((v - min) / range) * (height - pad * 2),
    ]);
    const d = points
      .map(([x, y], i) => (i === 0 ? 'M' : 'L') + ` ${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(' ');

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);

    if (this.hasAttribute('show-last-point')) {
      const last = points[points.length - 1];
      if (last) {
        const [lx, ly] = last;
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', String(lx));
        circle.setAttribute('cy', String(ly));
        circle.setAttribute('r', '2');
        circle.setAttribute('fill', color);
        svg.appendChild(circle);
      }
    }

    this.appendChild(svg);
  }
}

function normalize(next: unknown): number[] {
  if (!Array.isArray(next)) return [];
  const out: number[] = [];
  for (const item of next) {
    if (item == null) continue;
    if (typeof item === 'number') out.push(item);
    else if (typeof item === 'object' && (item as { y?: unknown }).y != null) {
      out.push(Number((item as { y: unknown }).y));
    } else {
      const n = Number(item);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out.filter((n) => Number.isFinite(n));
}

function parseCsv(str: string | null): number[] {
  if (!str) return [];
  return str.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}

AtlasElement.define('atlas-sparkline', AtlasSparkline);
