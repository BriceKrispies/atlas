import { AtlasElement } from '@atlas/core';

/**
 * <atlas-data-table-header-cell> — sortable column header.
 *
 * Attributes:
 *   - sortable      : presence = clickable header
 *   - sort-dir      : 'asc' | 'desc' | 'none'
 *   - column-key    : column key forwarded on click events
 *   - name          : testid source (standard AtlasElement convention)
 *
 * Emits (bubbling): `sort-toggle` { columnKey } when clicked / Enter / Space.
 *
 * Renders in light DOM — it sits inside an <atlas-row> child of
 * <atlas-table-head> and inherits its styles from the design primitives.
 */
class AtlasDataTableHeaderCell extends AtlasElement {
  static get observedAttributes() {
    return ['sortable', 'sort-dir', 'column-key'];
  }

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute('role', 'columnheader');
    this._ensureShell();
    this._syncAria();
    this._onKey = this._onKey.bind(this);
    this._onClick = this._onClick.bind(this);
    this.addEventListener('keydown', this._onKey);
    this.addEventListener('click', this._onClick);
  }

  disconnectedCallback() {
    this.removeEventListener('keydown', this._onKey);
    this.removeEventListener('click', this._onClick);
    super.disconnectedCallback?.();
  }

  attributeChangedCallback(name, oldVal, newVal) {
    if (oldVal === newVal) return;
    this._syncAria();
  }

  _ensureShell() {
    if (this.querySelector('[data-role="sort-indicator"]')) return;
    // Preserve the author-provided label text, append an indicator span.
    const indicator = document.createElement('span');
    indicator.setAttribute('data-role', 'sort-indicator');
    indicator.setAttribute('aria-hidden', 'true');
    this.appendChild(indicator);
  }

  _syncAria() {
    if (this.hasAttribute('sortable')) {
      this.setAttribute('tabindex', '0');
      const dir = this.getAttribute('sort-dir');
      this.setAttribute('aria-sort',
        dir === 'asc' ? 'ascending' :
        dir === 'desc' ? 'descending' : 'none');
    } else {
      this.removeAttribute('tabindex');
      this.removeAttribute('aria-sort');
    }
  }

  _onClick() {
    if (!this.hasAttribute('sortable')) return;
    this._emitToggle();
  }

  _onKey(e) {
    if (!this.hasAttribute('sortable')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this._emitToggle();
    }
  }

  _emitToggle() {
    this.dispatchEvent(new CustomEvent('sort-toggle', {
      bubbles: true,
      detail: { columnKey: this.getAttribute('column-key') },
    }));
  }
}

AtlasElement.define('atlas-data-table-header-cell', AtlasDataTableHeaderCell);
