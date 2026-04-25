import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText } from './util.ts';

/**
 * <atlas-stat> — single metric tile (layout-only primitive).
 *
 * Renders a labelled number with an optional unit and trend indicator.
 * Caller pre-formats the value (locale, decimals, units of base 10/2 etc.)
 * and passes it as a string. This element does no formatting — that is a
 * data concern, not a layout concern.
 *
 * Difference matrix:
 *   `<atlas-stat>` (here, @atlas/design) — primitive layout tile. No
 *       sparkline. No surface semantics. Use anywhere you want a
 *       big-number "kilo of these / kilo of those" cell. Layout only.
 *   `<atlas-kpi-tile>` (@atlas/widgets) — full widget with optional
 *       inline sparkline plus surface/widget instrumentation. Use inside
 *       a dashboard widget grid.
 *
 * In short: stat is to kpi-tile as input is to form-field — the
 * primitive vs. the composed surface.
 *
 * Attributes:
 *   label        — required label rendered above the value.
 *   value        — pre-formatted value string (e.g. "1,234", "97.4%").
 *   unit         — optional small trailing unit ("ms", "/day").
 *   trend        — up | down | flat — drives icon + colour.
 *   trend-label  — required when `trend` is set; visible text accompanying
 *                  the indicator (C3.11: colour MUST NOT be the only signal).
 *   variant      — default | success | warning | danger — tints the value.
 *   size         — sm | md (default) | lg — scales the numeric type.
 *
 * a11y:
 *   The host is `role="group"` with `aria-label="{label}"` so screen
 *   readers announce the label as the group name. The trend indicator
 *   has its own `aria-label` carrying the trend-label text.
 */

const sheet = createSheet(`
  :host {
    display: block;
    padding: var(--atlas-space-md);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
    min-width: 0;
  }
  :host([variant="success"]) { border-color: var(--atlas-color-success); }
  :host([variant="warning"]) { border-color: var(--atlas-color-warning); }
  :host([variant="danger"])  { border-color: var(--atlas-color-danger); }

  .label {
    display: block;
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-xs);
    font-weight: var(--atlas-font-weight-medium);
    line-height: 1.2;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--atlas-color-text-muted);
    margin-bottom: var(--atlas-space-xs);
    word-wrap: break-word;
  }
  .value-row {
    display: flex;
    align-items: baseline;
    gap: var(--atlas-space-xs);
    flex-wrap: wrap;
  }
  .value {
    font-family: var(--atlas-font-family);
    font-weight: var(--atlas-font-weight-bold);
    font-size: clamp(1.5rem, 4vw, 2rem);
    line-height: 1.1;
    color: var(--atlas-color-text);
    word-break: break-word;
  }
  :host([size="sm"]) .value { font-size: clamp(1.125rem, 3vw, 1.375rem); }
  :host([size="lg"]) .value { font-size: clamp(2rem, 6vw, 2.75rem); }
  :host([variant="success"]) .value { color: var(--atlas-color-success); }
  :host([variant="warning"]) .value { color: var(--atlas-color-warning); }
  :host([variant="danger"])  .value { color: var(--atlas-color-danger); }
  .unit {
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    color: var(--atlas-color-text-muted);
  }
  .trend {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: var(--atlas-space-xs);
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-xs);
    font-weight: var(--atlas-font-weight-medium);
    color: var(--atlas-color-text-muted);
  }
  .trend[data-trend="up"]   { color: var(--atlas-color-success); }
  .trend[data-trend="down"] { color: var(--atlas-color-danger); }
  .trend[data-trend="flat"] { color: var(--atlas-color-text-muted); }
  .trend .arrow {
    font-size: 0.85em;
    line-height: 1;
  }
`);

export class AtlasStat extends AtlasElement {
  declare label: string;
  declare value: string;
  declare unit: string;
  declare trend: string;
  declare trendLabel: string;
  declare variant: string;
  declare size: string;

  static {
    Object.defineProperty(this.prototype, 'label', AtlasElement.strAttr('label', ''));
    Object.defineProperty(this.prototype, 'value', AtlasElement.strAttr('value', ''));
    Object.defineProperty(this.prototype, 'unit', AtlasElement.strAttr('unit', ''));
    Object.defineProperty(this.prototype, 'trend', AtlasElement.strAttr('trend', ''));
    Object.defineProperty(this.prototype, 'trendLabel', AtlasElement.strAttr('trend-label', ''));
    Object.defineProperty(this.prototype, 'variant', AtlasElement.strAttr('variant', ''));
    Object.defineProperty(this.prototype, 'size', AtlasElement.strAttr('size', ''));
  }

  static override get observedAttributes(): readonly string[] {
    return ['label', 'value', 'unit', 'trend', 'trend-label', 'variant', 'size'];
  }

  private _built = false;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._built = true;
    this._render();
  }

  override attributeChangedCallback(): void {
    if (!this._built) return;
    this._render();
  }

  private _render(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const label = this.getAttribute('label') ?? '';
    const value = this.getAttribute('value') ?? '';
    const unit = this.getAttribute('unit') ?? '';
    const trend = this.getAttribute('trend') ?? '';
    const trendLabel = this.getAttribute('trend-label') ?? '';

    if (label) this.setAttribute('aria-label', label);
    else this.removeAttribute('aria-label');
    this.setAttribute('role', 'group');

    const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : trend === 'flat' ? '—' : '';
    const trendBlock = trend
      ? `<div class="trend" data-trend="${escapeAttr(trend)}" aria-label="${escapeAttr(trendLabel || `Trend ${trend}`)}">
           <span class="arrow" aria-hidden="true">${escapeText(arrow)}</span>
           <span class="trend-label">${escapeText(trendLabel)}</span>
         </div>`
      : '';

    const unitBlock = unit
      ? `<span class="unit">${escapeText(unit)}</span>`
      : '';

    root.innerHTML = `
      <span class="label">${escapeText(label)}</span>
      <div class="value-row">
        <span class="value">${escapeText(value)}</span>
        ${unitBlock}
      </div>
      ${trendBlock}
    `;
  }
}

AtlasElement.define('atlas-stat', AtlasStat);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-stat': AtlasStat;
  }
}
