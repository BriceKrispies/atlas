import { AtlasElement } from '@atlas/core';

/**
 * <atlas-tooltip> — on-hover / on-focus text popover anchored to a
 * trigger child. The trigger is any slotted element the author provides;
 * the tooltip bubble is placed against the `<atlas-tooltip>` host so the
 * author's layout (flex / inline) continues to work.
 *
 * Light DOM, but the bubble is an absolutely-positioned sibling of the
 * trigger inside the host element.
 *
 * Attributes:
 *   label     — required; tooltip text.
 *   placement — top (default) | bottom | left | right
 *   open      — (boolean, reflects). Set by internal handlers; also
 *               settable by authors to pin the tooltip open.
 *   delay     — ms before showing (default 150). `0` for instant.
 */
export class AtlasTooltip extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['label', 'placement', 'open'];
  }

  private _built = false;
  private _bubble: HTMLElement | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _id = `atlas-tooltip-${Math.random().toString(36).slice(2, 8)}`;

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._build();
    this._syncLabel();
  }

  override disconnectedCallback(): void {
    if (this._timer) clearTimeout(this._timer);
    super.disconnectedCallback?.();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'label') this._syncLabel();
    if (name === 'open') this._syncOpen();
  }

  private _build(): void {
    const bubble = document.createElement('div');
    bubble.setAttribute('role', 'tooltip');
    bubble.id = this._id;
    bubble.setAttribute('data-part', 'bubble');
    bubble.hidden = true;
    this.appendChild(bubble);
    this._bubble = bubble;
    // Annotate the trigger (first non-bubble child) with aria-describedby
    // if it doesn't already have one, so SR users hear the tooltip.
    queueMicrotask(() => {
      const trigger = this._findTrigger();
      if (trigger && !trigger.hasAttribute('aria-describedby')) {
        trigger.setAttribute('aria-describedby', this._id);
      }
    });
    this.addEventListener('pointerenter', () => this._schedule(true));
    this.addEventListener('pointerleave', () => this._schedule(false));
    this.addEventListener('focusin', () => this._schedule(true));
    this.addEventListener('focusout', () => this._schedule(false));
    this.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.hasAttribute('open')) {
        this.removeAttribute('open');
      }
    });
    this._built = true;
  }

  private _findTrigger(): HTMLElement | null {
    for (const child of Array.from(this.children)) {
      if (child === this._bubble) continue;
      return child as HTMLElement;
    }
    return null;
  }

  private _schedule(show: boolean): void {
    if (this._timer) clearTimeout(this._timer);
    const delay = show ? Number(this.getAttribute('delay') ?? '150') : 0;
    this._timer = setTimeout(() => {
      if (show) this.setAttribute('open', '');
      else this.removeAttribute('open');
    }, Math.max(0, delay));
  }

  private _syncLabel(): void {
    if (!this._bubble) return;
    this._bubble.textContent = this.getAttribute('label') ?? '';
  }

  private _syncOpen(): void {
    if (!this._bubble) return;
    const open = this.hasAttribute('open');
    this._bubble.hidden = !open;
  }
}

AtlasElement.define('atlas-tooltip', AtlasTooltip);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-tooltip': AtlasTooltip;
  }
}
