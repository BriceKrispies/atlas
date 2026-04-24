import { AtlasElement } from '@atlas/core';

/**
 * <atlas-drawer> — side sheet that slides in from an edge. Modal
 * behaviour (focus trap, Esc-to-close, backdrop click) piggybacks on
 * the native `<dialog>` element, same as `<atlas-dialog>`.
 *
 * Visually distinct: full-height, edge-anchored, slide-in animation.
 *
 * Slots:
 *   heading — title row.
 *   default — body content. Scrolls if overflowed.
 *   actions — sticky footer buttons.
 *
 * Light DOM.
 *
 * API:
 *   .open()
 *   .close(returnValue?)
 *
 * Attributes:
 *   open       — (boolean, reflected)
 *   side       — start (default) | end | top | bottom. `start`/`end`
 *                are logical so the drawer flips under RTL.
 *   size       — sm | md (default) | lg — width (or height for
 *                top/bottom). Ignored in favour of your CSS if set
 *                externally.
 *   heading    — convenience shortcut.
 *   dismissible — (boolean, default true) — × button + backdrop close.
 *
 * Events:
 *   open, close — mirror atlas-dialog.
 */
export class AtlasDrawer extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['open', 'heading', 'side', 'size', 'dismissible'];
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

  open(): void {
    if (!this._dialog) return;
    if (!this._dialog.open) {
      this._dialog.showModal();
      if (!this.hasAttribute('open')) this.setAttribute('open', '');
      this.dispatchEvent(new CustomEvent('open', { bubbles: true, composed: true }));
    }
  }

  close(returnValue = ''): void {
    if (this._dialog?.open) this._dialog.close(returnValue);
  }

  private _build(): void {
    const headingSlot = this.querySelector(':scope > [slot="heading"]');
    const actionsSlot = this.querySelector(':scope > [slot="actions"]');
    const bodyNodes: Node[] = [];
    for (const child of Array.from(this.childNodes)) {
      if (child instanceof Element) {
        const s = child.getAttribute('slot');
        if (s === 'heading' || s === 'actions') continue;
      }
      bodyNodes.push(child);
    }

    const d = document.createElement('dialog');
    d.setAttribute('data-part', 'drawer');

    const header = document.createElement('header');
    header.setAttribute('data-part', 'header');
    if (headingSlot) header.appendChild(headingSlot);
    else if (this.hasAttribute('heading')) {
      const h = document.createElement('h2');
      h.setAttribute('slot', 'heading');
      h.textContent = this.getAttribute('heading') ?? '';
      header.appendChild(h);
    }
    const close = this._makeClose();
    header.appendChild(close);

    const body = document.createElement('div');
    body.setAttribute('data-part', 'body');
    for (const n of bodyNodes) body.appendChild(n);

    d.appendChild(header);
    d.appendChild(body);

    if (actionsSlot) {
      const footer = document.createElement('footer');
      footer.setAttribute('data-part', 'footer');
      footer.appendChild(actionsSlot);
      d.appendChild(footer);
    }

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
    d.addEventListener('click', (ev) => {
      if (!this._isDismissible()) return;
      if (ev.target === d) d.close();
    });
    this._built = true;
  }

  private _makeClose(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-atlas-drawer-close', '');
    btn.setAttribute('aria-label', 'Close');
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    btn.addEventListener('click', () => this.close());
    return btn;
  }

  private _isDismissible(): boolean {
    return this.getAttribute('dismissible') !== 'false';
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

AtlasElement.define('atlas-drawer', AtlasDrawer);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-drawer': AtlasDrawer;
  }
}
