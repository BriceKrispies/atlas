import { AtlasElement } from '@atlas/core';

/**
 * <atlas-accordion> — vertical stack of collapsible sections.
 *
 * Expects `<atlas-accordion-item>` children. The accordion is the policy
 * holder: when `type="single"` (default), opening an item closes the
 * others. When `type="multiple"`, items toggle independently.
 *
 * Light DOM. Styled via elements.css.
 *
 * Attributes:
 *   type  — single (default) | multiple
 *
 * Events:
 *   toggle → CustomEvent<{ value: string; open: boolean }> — bubbles up
 *            from child items; the accordion itself doesn't emit.
 */
export class AtlasAccordion extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute('role')) this.setAttribute('role', 'group');
    this.addEventListener('toggle', (ev) => {
      const detail = (ev as unknown as CustomEvent<{ value: string; open: boolean }>).detail;
      if (!detail?.open) return;
      if ((this.getAttribute('type') ?? 'single') !== 'single') return;
      const items = Array.from(
        this.querySelectorAll('atlas-accordion-item'),
      ) as AtlasAccordionItem[];
      for (const item of items) {
        if (item.getAttribute('value') !== detail.value && item.hasAttribute('open')) {
          item.removeAttribute('open');
        }
      }
    });
  }
}

AtlasElement.define('atlas-accordion', AtlasAccordion);

/**
 * <atlas-accordion-item> — one expandable row.
 *
 * Slot-driven content: the first slotted child with `slot="summary"` (or
 * the first text node) becomes the header label. Everything else is the
 * expandable body.
 *
 * Attributes:
 *   value     — required; identifies the item for `toggle` events.
 *   open      — (boolean) reflects expansion state.
 *   disabled  — (boolean) non-interactive.
 */
export class AtlasAccordionItem extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['open', 'disabled'];
  }

  private _built = false;
  private _button: HTMLButtonElement | null = null;
  private _body: HTMLElement | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._build();
    this._syncOpen();
    this._syncDisabled();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'open') this._syncOpen();
    if (name === 'disabled') this._syncDisabled();
  }

  private _build(): void {
    // Extract summary + body from existing light-DOM children. The
    // header uses the first text node or `[slot="summary"]`; everything
    // else becomes the expandable body.
    const items: Node[] = Array.from(this.childNodes);
    let summaryNode: Node | null = null;
    const bodyNodes: Node[] = [];
    for (const n of items) {
      if (summaryNode == null) {
        if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) {
          summaryNode = n;
          continue;
        }
        if (n instanceof Element && n.getAttribute('slot') === 'summary') {
          summaryNode = n;
          continue;
        }
      }
      bodyNodes.push(n);
    }

    // Build chrome
    this.innerHTML = '';
    const header = document.createElement('div');
    header.setAttribute('data-part', 'header');
    const button = document.createElement('button');
    button.setAttribute('type', 'button');
    button.setAttribute('data-part', 'trigger');
    button.setAttribute('aria-expanded', 'false');
    const summarySpan = document.createElement('span');
    summarySpan.setAttribute('data-part', 'summary');
    if (summaryNode) summarySpan.appendChild(summaryNode);
    const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('viewBox', '0 0 16 16');
    chev.setAttribute('data-part', 'chevron');
    chev.setAttribute('aria-hidden', 'true');
    chev.setAttribute('focusable', 'false');
    chev.innerHTML = '<path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
    button.appendChild(summarySpan);
    button.appendChild(chev);
    header.appendChild(button);

    const body = document.createElement('div');
    body.setAttribute('data-part', 'body');
    body.setAttribute('role', 'region');
    for (const n of bodyNodes) body.appendChild(n);

    this.appendChild(header);
    this.appendChild(body);
    this._button = button;
    this._body = body;

    button.addEventListener('click', () => this._toggle());
    this._built = true;
  }

  private _toggle(): void {
    if (this.hasAttribute('disabled')) return;
    const wasOpen = this.hasAttribute('open');
    if (wasOpen) this.removeAttribute('open');
    else this.setAttribute('open', '');
    this.dispatchEvent(
      new CustomEvent('toggle', {
        detail: { value: this.getAttribute('value') ?? '', open: !wasOpen },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _syncOpen(): void {
    const open = this.hasAttribute('open');
    if (this._button) this._button.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (this._body) {
      this._body.hidden = !open;
      if (open) this._body.removeAttribute('hidden');
    }
  }

  private _syncDisabled(): void {
    const disabled = this.hasAttribute('disabled');
    if (this._button) {
      if (disabled) this._button.setAttribute('disabled', '');
      else this._button.removeAttribute('disabled');
    }
  }
}

AtlasElement.define('atlas-accordion-item', AtlasAccordionItem);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-accordion': AtlasAccordion;
    'atlas-accordion-item': AtlasAccordionItem;
  }
}
