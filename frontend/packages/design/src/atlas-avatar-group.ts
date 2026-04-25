import { AtlasElement } from '@atlas/core';

/**
 * <atlas-avatar-group> — horizontally-overlapping cluster of <atlas-avatar>.
 *
 * **Light DOM rationale**
 * The group's value-add is purely visual (overlap + overflow chip). All the
 * accessibility, image fallback, status dot logic already lives on each
 * <atlas-avatar>. If we used a shadow root with a <slot>, consumers would
 * get the same overlap appearance but lose:
 *   - direct queryability (`querySelectorAll('atlas-avatar')` still works)
 *   - per-child styling that document CSS can reach
 *   - debug ergonomics (everything visible in DevTools' main tree)
 * The cost of light DOM is that we must observe child mutations to know
 * when to recompute the overflow chip — that's `MutationObserver`, which
 * is well-understood and cheap.
 *
 * Attributes:
 *   max — integer (default 4). Children beyond this limit are hidden and
 *         counted into a "+N" chip rendered at the end.
 *
 * Accessibility:
 *   role="group" with aria-label="<N> members" so AT users hear the size
 *   of the cluster up front. The overflow chip is a real <button> so it
 *   carries focus and announces "+3 more: Charlie, Dana, Eve".
 */
export class AtlasAvatarGroup extends AtlasElement {
  private _observer: MutationObserver | null = null;
  /** Re-entrancy guard: `_sync()` mutates light-DOM children, which the
   *  observer would notice and re-trigger. Without this we'd loop. */
  private _syncing = false;

  static override get observedAttributes(): readonly string[] {
    return ['max'];
  }

  get max(): number {
    const n = Number.parseInt(this.getAttribute('max') ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 4;
  }
  set max(v: number) {
    if (!Number.isFinite(v) || v <= 0) this.removeAttribute('max');
    else this.setAttribute('max', String(Math.floor(v)));
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'group');
    this._observer = new MutationObserver(() => {
      if (this._syncing) return;
      this._sync();
    });
    this._observer.observe(this, { childList: true, subtree: false });
    this._sync();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._observer?.disconnect();
    this._observer = null;
  }

  override attributeChangedCallback(name: string): void {
    if (name === 'max') this._sync();
  }

  private _sync(): void {
    this._syncing = true;
    try {
      // Remove any previously-rendered overflow chip; we recompute fresh.
      const previous = this.querySelector<HTMLElement>(':scope > [data-atlas-overflow]');
      previous?.remove();

      const children = Array.from(
        this.querySelectorAll<HTMLElement>(':scope > atlas-avatar'),
      );
      const max = this.max;

      // Reset visibility on all avatars first — covers the case where max
      // was just increased and previously-hidden children should re-appear.
      for (const c of children) {
        c.style.removeProperty('display');
        c.removeAttribute('aria-hidden');
      }

      const overflow = children.length > max ? children.slice(max) : [];
      for (const c of overflow) {
        c.style.display = 'none';
        c.setAttribute('aria-hidden', 'true');
      }

      // Update group label so AT hears the *visible* member count.
      const total = children.length;
      this.setAttribute('aria-label', `${total} ${total === 1 ? 'member' : 'members'}`);

      if (overflow.length > 0) {
        const hiddenNames = overflow
          .map((el) => el.getAttribute('name') ?? '')
          .filter((n) => n.length > 0);
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.setAttribute('data-atlas-overflow', '');
        chip.className = 'atlas-avatar-overflow';
        chip.textContent = `+${overflow.length}`;
        // Focusable announce-text so SR users hear who's been collapsed.
        const summary = hiddenNames.length > 0
          ? `${overflow.length} more: ${hiddenNames.join(', ')}`
          : `${overflow.length} more`;
        chip.setAttribute('aria-label', summary);
        this.appendChild(chip);
      }
    } finally {
      this._syncing = false;
    }
  }
}

AtlasElement.define('atlas-avatar-group', AtlasAvatarGroup);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-avatar-group': AtlasAvatarGroup;
  }
}
