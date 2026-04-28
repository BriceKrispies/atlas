import { AtlasElement } from '@atlas/core';

/**
 * <atlas-alert> — inline status banner. Info, success, warning, or
 * danger. Use for transient page-level messages; prefer `<atlas-toast>`
 * for app-wide ephemeral notifications (ToastProvider, Phase C3).
 *
 * Slots:
 *   icon    — optional leading icon. Auto-chosen per tone if omitted.
 *   heading — optional heading line above the body.
 *   default — body content.
 *   actions — optional trailing buttons (e.g. "Dismiss", "Retry").
 *
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   tone        — info (default) | success | warning | danger
 *   dismissible — (boolean) renders a built-in close button on the
 *                 trailing edge. Clicking it hides the alert and fires
 *                 `dismiss` (composed).
 *   heading     — convenience: shortcut for the heading slot.
 */
export class AtlasAlert extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['tone', 'dismissible', 'heading'];
  }

  private _built = false;

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._build();
    this._syncRole();
    this._syncHeadingAttr();
    this._syncDismissible();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'tone') this._syncRole();
    if (name === 'heading') this._syncHeadingAttr();
    if (name === 'dismissible') this._syncDismissible();
  }

  private _build(): void {
    // Ensure heading slot exists if the attribute was provided.
    const hasHeadingSlot = this.querySelector(':scope > [slot="heading"]') !== null;
    if (!hasHeadingSlot && this.hasAttribute('heading')) {
      const h = document.createElement('atlas-text');
      h.setAttribute('variant', 'medium');
      h.setAttribute('slot', 'heading');
      this.insertBefore(h, this.firstChild);
    }
    this._built = true;
  }

  private _syncRole(): void {
    const tone = this.getAttribute('tone') ?? 'info';
    // `danger` is typically urgent — escalate to role=alert so AT
    // announces it immediately. Others use role=status for polite.
    this.setAttribute('role', tone === 'danger' ? 'alert' : 'status');
  }

  private _syncHeadingAttr(): void {
    const slot = this.querySelector(':scope > atlas-text[slot="heading"]');
    if (slot && this.hasAttribute('heading')) {
      slot.textContent = this.getAttribute('heading') ?? '';
    }
  }

  private _syncDismissible(): void {
    const existing = this.querySelector(':scope > [data-part="dismiss"]');
    const want = this.hasAttribute('dismissible');
    if (want && !existing) {
      const btn = document.createElement('button');
      btn.setAttribute('type', 'button');
      btn.setAttribute('data-part', 'dismiss');
      btn.setAttribute('aria-label', 'Dismiss');
      btn.innerHTML =
        '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
      btn.addEventListener('click', () => {
        this.remove();
        this.dispatchEvent(
          new CustomEvent('dismiss', { bubbles: true, composed: true }),
        );
      });
      this.appendChild(btn);
    } else if (!want && existing) {
      existing.remove();
    }
  }
}

AtlasElement.define('atlas-alert', AtlasAlert);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-alert': AtlasAlert;
  }
}
