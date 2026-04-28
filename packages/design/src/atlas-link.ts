import { AtlasElement } from '@atlas/core';

/**
 * <atlas-link> — styled inline link. Wraps a real `<a>` (slotted
 * content or href-driven behaviour) with design-system tokens.
 *
 * Light DOM pass-through. Styled via elements.css targeting both
 * `<atlas-link>` and `<atlas-link> > a`.
 *
 * Usage:
 *   <atlas-link href="/docs">Docs</atlas-link>
 *
 * If `href` is set, a real `<a>` is created with the element's text
 * content (so keyboard + middle-click + right-click work). If it's
 * not set (pure styling of an existing child `<a>` / `<button>`),
 * the element passes through.
 *
 * Attributes:
 *   href      — if set, wraps children in an `<a>` with this URL.
 *   target    — standard anchor target.
 *   rel       — defaults to `noopener noreferrer` when target=_blank.
 *   tone      — default (primary) | muted
 *   underline — hover (default) | always | none
 */
export class AtlasLink extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['href', 'target', 'rel'];
  }

  private _built = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this._maybeBuild();
  }

  override attributeChangedCallback(): void {
    if (!this.isConnected) return;
    if (this._built) this._syncAnchor();
    else this._maybeBuild();
  }

  private _maybeBuild(): void {
    if (this._built) return;
    const href = this.getAttribute('href');
    if (href == null) return;
    // Wrap existing children in a single <a>. Only done once; subsequent
    // href changes update the existing <a>.
    const anchor = document.createElement('a');
    anchor.setAttribute('href', href);
    while (this.firstChild) anchor.appendChild(this.firstChild);
    this.appendChild(anchor);
    this._built = true;
    this._syncAnchor();
  }

  private _syncAnchor(): void {
    const anchor = this.querySelector(':scope > a');
    if (!(anchor instanceof HTMLAnchorElement)) return;
    const href = this.getAttribute('href');
    if (href != null) anchor.setAttribute('href', href);
    const target = this.getAttribute('target');
    if (target) {
      anchor.setAttribute('target', target);
      if (target === '_blank' && !this.hasAttribute('rel')) {
        anchor.setAttribute('rel', 'noopener noreferrer');
      }
    } else {
      anchor.removeAttribute('target');
    }
    const rel = this.getAttribute('rel');
    if (rel) anchor.setAttribute('rel', rel);
  }
}

AtlasElement.define('atlas-link', AtlasLink);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-link': AtlasLink;
  }
}
