import { AtlasElement } from '@atlas/core';

/**
 * <atlas-heading> — heading element. Replaces <h1>-<h6>.
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   level — 1-6 (default 1). Observed — mutating it updates aria-level live.
 */
export class AtlasHeading extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['level'];
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'heading');
    this._syncLevel();
  }

  override attributeChangedCallback(
    name: string,
    _oldValue: string | null,
    _newValue: string | null,
  ): void {
    if (name === 'level') this._syncLevel();
  }

  private _syncLevel(): void {
    const level = this.getAttribute('level') ?? '1';
    this.setAttribute('aria-level', level);
  }
}

AtlasElement.define('atlas-heading', AtlasHeading);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-heading': AtlasHeading;
  }
}
