import { AtlasElement } from '@atlas/core';

/**
 * <atlas-heading> — heading element. Replaces <h1>-<h6>.
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   level — 1-6 (default 1)
 */
class AtlasHeading extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
    const level = this.getAttribute('level') ?? '1';
    this.setAttribute('role', 'heading');
    this.setAttribute('aria-level', level);
  }
}

AtlasElement.define('atlas-heading', AtlasHeading);
