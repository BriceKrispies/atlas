import { AtlasElement } from '@atlas/core';

/**
 * <atlas-empty-state> — standardised "nothing here yet" surface.
 *
 * Slots (any subset):
 *   default (unnamed) — optional illustration / icon at the top. A
 *                       `<atlas-icon>` or small SVG typically goes here.
 *   heading           — short title. Falls back to the `heading` attribute.
 *   description       — longer explanation. Falls back to the `description`
 *                       attribute.
 *   actions           — one or more `<atlas-button>` call-to-actions.
 *
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   tone        — default | subtle (less visual weight)
 *   heading     — convenience: shortcut for the heading slot.
 *   description — convenience: shortcut for the description slot.
 */
export class AtlasEmptyState extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['heading', 'description'];
  }

  private _built = false;

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._build();
    this._syncFromAttrs();
  }

  override attributeChangedCallback(): void {
    if (!this._built) return;
    this._syncFromAttrs();
  }

  private _build(): void {
    // If the author passed heading/description as slots, leave them
    // alone. Otherwise create placeholder elements the attribute sync
    // will populate.
    const hasHeadingSlot = this.querySelector(':scope > [slot="heading"]') !== null;
    const hasDescSlot = this.querySelector(':scope > [slot="description"]') !== null;
    if (!hasHeadingSlot) {
      const h = document.createElement('atlas-heading');
      h.setAttribute('level', '4');
      h.setAttribute('slot', 'heading');
      this.insertBefore(h, this.querySelector(':scope > [slot="description"], :scope > [slot="actions"]'));
    }
    if (!hasDescSlot) {
      const d = document.createElement('atlas-text');
      d.setAttribute('variant', 'muted');
      d.setAttribute('slot', 'description');
      this.insertBefore(d, this.querySelector(':scope > [slot="actions"]'));
    }
    this._built = true;
  }

  private _syncFromAttrs(): void {
    const headingEl = this.querySelector(':scope > atlas-heading[slot="heading"]');
    if (headingEl && this.hasAttribute('heading')) {
      headingEl.textContent = this.getAttribute('heading') ?? '';
    }
    const descEl = this.querySelector(':scope > atlas-text[slot="description"]');
    if (descEl && this.hasAttribute('description')) {
      descEl.textContent = this.getAttribute('description') ?? '';
    }
  }
}

AtlasElement.define('atlas-empty-state', AtlasEmptyState);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-empty-state': AtlasEmptyState;
  }
}
