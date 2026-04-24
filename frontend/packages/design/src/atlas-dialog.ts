import { AtlasElement } from '@atlas/core';

/**
 * <atlas-dialog> — modal dialog built on top of the native `<dialog>`
 * element. A real `<dialog>` inside gives us:
 *   - free keyboard focus trap + Esc-to-close
 *   - free `::backdrop` + scroll-lock
 *   - inert-outside semantics for screen readers
 *
 * Slot layout (all optional):
 *   heading — short title; rendered as the `<h2>` inside the dialog.
 *   default — body content.
 *   actions — trailing button row.
 *   close   — override the auto-generated × button. Supply your own
 *             `<button type="button" data-atlas-dialog-close>`.
 *
 * Light DOM.
 *
 * API:
 *   .open() — show as modal (show() for non-modal reserved for future)
 *   .close(returnValue?) — close and emit `close` with `{ returnValue }`
 *   .isOpen — getter
 *
 * Attributes:
 *   open       — (boolean, reflected) current state. Mutating it
 *                open()/close()s the dialog.
 *   heading    — convenience shortcut for the heading slot.
 *   size       — sm | md (default) | lg — max-width hint.
 *   dismissible — (boolean, default true) — shows the × close button
 *                 and allows backdrop click to close.
 *
 * Events:
 *   open  — after opening.
 *   close — after closing. detail: { returnValue: string }.
 */
export class AtlasDialog extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['open', 'heading', 'size', 'dismissible'];
  }

  private _built = false;
  private _dialog: HTMLDialogElement | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._build();
    this._syncHeading();
    this._syncOpenAttr();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'open') this._syncOpenAttr();
    if (name === 'heading') this._syncHeading();
  }

  get isOpen(): boolean {
    return this._dialog?.open ?? false;
  }

  open(): void {
    if (!this._dialog) return;
    if (!this._dialog.open) {
      this._dialog.showModal();
      if (!this.hasAttribute('open')) this.setAttribute('open', '');
      this.dispatchEvent(new CustomEvent('open', { bubbles: true, composed: true }));
    }
  }

  close(returnValue = ''): void {
    if (!this._dialog) return;
    if (this._dialog.open) {
      this._dialog.close(returnValue);
    }
  }

  private _build(): void {
    // Harvest slotted children from light DOM and re-parent into a
    // native <dialog>. Keep slot attributes so we can style them in
    // elements.css.
    const headingSlot = this.querySelector(':scope > [slot="heading"]');
    const actionsSlot = this.querySelector(':scope > [slot="actions"]');
    const closeSlot = this.querySelector(':scope > [slot="close"]');
    const bodyNodes: Node[] = [];
    for (const child of Array.from(this.childNodes)) {
      if (child instanceof Element) {
        const s = child.getAttribute('slot');
        if (s === 'heading' || s === 'actions' || s === 'close') continue;
      }
      bodyNodes.push(child);
    }

    const d = document.createElement('dialog');
    d.setAttribute('data-part', 'dialog');
    // Surface section
    const header = document.createElement('header');
    header.setAttribute('data-part', 'header');
    if (headingSlot) header.appendChild(headingSlot);
    else if (this.hasAttribute('heading')) {
      const h = document.createElement('h2');
      h.setAttribute('slot', 'heading');
      h.textContent = this.getAttribute('heading') ?? '';
      header.appendChild(h);
    }
    const close = closeSlot ?? this._makeClose();
    header.appendChild(close);

    const body = document.createElement('div');
    body.setAttribute('data-part', 'body');
    for (const n of bodyNodes) body.appendChild(n);

    const footer = document.createElement('footer');
    footer.setAttribute('data-part', 'footer');
    if (actionsSlot) footer.appendChild(actionsSlot);

    d.appendChild(header);
    d.appendChild(body);
    if (actionsSlot) d.appendChild(footer);

    // Clear any leftover light-dom then append the dialog.
    this.innerHTML = '';
    this.appendChild(d);
    this._dialog = d;

    d.addEventListener('close', () => {
      if (this.hasAttribute('open')) this.removeAttribute('open');
      this.dispatchEvent(
        new CustomEvent('close', {
          detail: { returnValue: d.returnValue ?? '' },
          bubbles: true,
          composed: true,
        }),
      );
    });

    // Backdrop click-to-close (when dismissible).
    d.addEventListener('click', (ev) => {
      if (!this._isDismissible()) return;
      // Native <dialog> click targets the dialog itself when the user
      // clicks the backdrop (the dialog's box sits above the backdrop).
      if (ev.target === d) d.close();
    });

    this._built = true;
  }

  private _makeClose(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-atlas-dialog-close', '');
    btn.setAttribute('aria-label', 'Close');
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    btn.addEventListener('click', () => this.close());
    return btn;
  }

  private _isDismissible(): boolean {
    const attr = this.getAttribute('dismissible');
    return attr !== 'false'; // default true
  }

  private _syncOpenAttr(): void {
    if (!this._dialog) return;
    const want = this.hasAttribute('open');
    if (want && !this._dialog.open) this.open();
    else if (!want && this._dialog.open) this.close();
  }

  private _syncHeading(): void {
    if (!this._dialog) return;
    const h = this._dialog.querySelector('[slot="heading"]');
    if (h && this.hasAttribute('heading')) {
      h.textContent = this.getAttribute('heading') ?? '';
    }
  }
}

AtlasElement.define('atlas-dialog', AtlasDialog);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-dialog': AtlasDialog;
  }
}
