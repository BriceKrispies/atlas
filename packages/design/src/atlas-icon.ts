import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr } from './util.ts';
import { getIcon, type AtlasIconEntry } from './icons.ts';

/**
 * <atlas-icon> — inline SVG icon with a central registry.
 *
 * Renders the icon identified by `name` from `icons.ts`. The icon inherits
 * the surrounding text colour via `currentColor` and scales with the font
 * (`1em`) unless `size` is set, in which case the host resolves to an
 * explicit pixel dimension (`sm`=14 / `md`=16 / `lg`=22).
 *
 * Attributes:
 *   name   - icon registry key. Required.
 *   size   - `sm` | `md` | `lg`. Default is `1em` (inherits from text).
 *   label  - if set, an accessible name; otherwise the icon is decorative
 *            (`aria-hidden="true"`).
 *
 * Unknown names render nothing and log a single `console.warn`.
 */
const sheet = createSheet(`
  :host {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1em;
    height: 1em;
    color: currentColor;
    flex-shrink: 0;
    line-height: 0;
  }
  :host([size="sm"]) { width: 14px; height: 14px; }
  :host([size="md"]) { width: 16px; height: 16px; }
  :host([size="lg"]) { width: 22px; height: 22px; }
  :host([spin]) svg { animation: atlas-icon-spin 800ms linear infinite; }
  svg {
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
  }
  @keyframes atlas-icon-spin { to { transform: rotate(360deg); } }
`);

const _warnedNames = new Set<string>();

export class AtlasIcon extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['name', 'size', 'label'];
  }

  declare name: string;
  declare size: string;
  declare label: string;

  static {
    Object.defineProperty(this.prototype, 'name', AtlasElement.strAttr('name', ''));
    Object.defineProperty(this.prototype, 'size', AtlasElement.strAttr('size', ''));
    Object.defineProperty(this.prototype, 'label', AtlasElement.strAttr('label', ''));
  }

  private _built = false;
  private _svgHost: HTMLSpanElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._syncAll();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    this._sync(name);
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const host = document.createElement('span');
    host.setAttribute('part', 'svg');
    root.appendChild(host);
    this._svgHost = host;
    this._built = true;
  }

  private _syncAll(): void {
    this._sync('label');
    this._sync('name');
  }

  private _sync(attr: string): void {
    switch (attr) {
      case 'name':
        this._renderSvg();
        break;
      case 'size':
        // The host `size` attribute drives CSS via the `:host([size="…"])`
        // selectors in the shared stylesheet — nothing to render-sync.
        break;
      case 'label':
        this._applyA11y();
        break;
    }
  }

  private _applyA11y(): void {
    const label = this.getAttribute('label');
    if (label && label.trim() !== '') {
      this.setAttribute('role', 'img');
      this.setAttribute('aria-label', label);
      this.removeAttribute('aria-hidden');
    } else {
      this.setAttribute('aria-hidden', 'true');
      this.removeAttribute('role');
      this.removeAttribute('aria-label');
    }
  }

  private _renderSvg(): void {
    const host = this._svgHost;
    if (!host) return;
    const name = this.getAttribute('name') ?? '';
    if (!name) {
      host.innerHTML = '';
      return;
    }
    const entry = getIcon(name);
    if (!entry) {
      host.innerHTML = '';
      if (!_warnedNames.has(name)) {
        _warnedNames.add(name);
        console.warn('[atlas-icon] unknown icon "%s"', name);
      }
      return;
    }
    host.innerHTML = _buildSvg(entry);
  }
}

function _buildSvg(entry: AtlasIconEntry): string {
  const filled = entry.filled === true;
  const stroke = filled ? 'none' : 'currentColor';
  const fill = filled ? 'currentColor' : 'none';
  const sw = entry.strokeWidth ?? '2';
  const slc = entry.strokeLinecap ?? '';
  const slj = entry.strokeLinejoin ?? '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${escapeAttr(entry.viewBox)}"` +
    ` fill="${fill}" stroke="${stroke}" stroke-width="${escapeAttr(sw)}"` +
    (slc ? ` stroke-linecap="${escapeAttr(slc)}"` : '') +
    (slj ? ` stroke-linejoin="${escapeAttr(slj)}"` : '') +
    ` aria-hidden="true" focusable="false">` +
    entry.paths +
    `</svg>`
  );
}

AtlasElement.define('atlas-icon', AtlasIcon);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-icon': AtlasIcon;
  }
}
