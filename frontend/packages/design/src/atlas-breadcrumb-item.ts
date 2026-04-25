import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-breadcrumb-item> — single segment of an `<atlas-breadcrumbs>`
 * trail. Renders as an inline link (when `href` is set and `current` is
 * absent) or as plain text (the trailing segment, marked with
 * `aria-current="page"`).
 *
 * Attributes:
 *   href     — URL for non-terminal items.
 *   current  — when present, the item renders as plain text and the
 *              host gets `aria-current="page"`.
 *   collapsed — set by the parent breadcrumbs element to hide an item
 *               participating in the overflow-collapse window. Hidden
 *               via CSS only; ARIA is unaffected so screen readers
 *               still see the full trail when expanded.
 *
 * Light DOM child of <atlas-breadcrumbs> from the consumer's POV; we
 * use shadow DOM internally so the parent's `<ol>` can reliably wrap
 * each `<li>` around the slotted host.
 */

const sheet = createSheet(`
  :host {
    display: inline-flex;
    align-items: center;
    color: var(--atlas-color-text-muted);
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-sm);
    line-height: var(--atlas-line-height);
  }
  :host([collapsed]) { display: none; }
  a, span.text {
    display: inline-flex;
    align-items: center;
    min-height: var(--atlas-touch-target-min, 44px);
    padding: var(--atlas-space-xs) var(--atlas-space-xs);
    border-radius: var(--atlas-radius-sm);
    text-decoration: none;
    color: inherit;
    -webkit-tap-highlight-color: transparent;
  }
  a {
    color: var(--atlas-color-primary);
    cursor: pointer;
  }
  a:hover { text-decoration: underline; text-underline-offset: 0.15em; }
  a:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  :host([current]) span.text {
    color: var(--atlas-color-text);
    font-weight: var(--atlas-font-weight-medium);
    cursor: default;
  }
`);

export class AtlasBreadcrumbItem extends AtlasElement {
  declare href: string;
  declare current: boolean;
  declare collapsed: boolean;

  static {
    Object.defineProperty(this.prototype, 'href', AtlasElement.strAttr('href', ''));
    Object.defineProperty(this.prototype, 'current', AtlasElement.boolAttr('current'));
    Object.defineProperty(this.prototype, 'collapsed', AtlasElement.boolAttr('collapsed'));
  }

  static override get observedAttributes(): readonly string[] {
    return ['href', 'current'];
  }

  private _built = false;
  private _anchor: HTMLAnchorElement | null = null;
  private _text: HTMLSpanElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._syncShape();
    this._syncAriaCurrent();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'href' || name === 'current') {
      this._syncShape();
      this._syncAriaCurrent();
    }
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    // Two siblings, one of them visible at a time:
    //   <a><slot></slot></a>
    //   <span class="text"><slot></slot></span>
    // Slot can only project once, so we move the visible sibling's
    // children at sync time. We render the slot inside a span and
    // wrap it in either an anchor or a span.text container.
    const anchor = document.createElement('a');
    const text = document.createElement('span');
    text.className = 'text';
    const slotInside = document.createElement('slot');
    // Default to anchor; _syncShape() will swap as needed.
    anchor.appendChild(slotInside);
    root.appendChild(anchor);
    root.appendChild(text);
    this._anchor = anchor;
    this._text = text;
    this._built = true;
  }

  private _syncShape(): void {
    if (!this._anchor || !this._text) return;
    const isCurrent = this.hasAttribute('current');
    const href = this.getAttribute('href');
    if (isCurrent || !href) {
      // Show plain text; move the slot into the text span.
      const slotEl = this._anchor.querySelector('slot');
      if (slotEl) this._text.appendChild(slotEl);
      this._anchor.style.display = 'none';
      this._text.style.display = 'inline-flex';
      this._anchor.removeAttribute('href');
    } else {
      const slotEl = this._text.querySelector('slot');
      if (slotEl) this._anchor.appendChild(slotEl);
      this._anchor.setAttribute('href', href);
      this._anchor.style.display = 'inline-flex';
      this._text.style.display = 'none';
    }
  }

  private _syncAriaCurrent(): void {
    if (this.hasAttribute('current')) this.setAttribute('aria-current', 'page');
    else this.removeAttribute('aria-current');
  }
}

AtlasElement.define('atlas-breadcrumb-item', AtlasBreadcrumbItem);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-breadcrumb-item': AtlasBreadcrumbItem;
  }
}
