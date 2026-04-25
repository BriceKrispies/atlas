import { AtlasElement } from '@atlas/core';

/**
 * <atlas-chip-group> — container that coordinates selection across child
 * <atlas-chip> elements. Light DOM: chips are slotted directly so they
 * remain queryable and inherit document styles.
 *
 * Attributes:
 *   selection — single | multiple | none (default single)
 *   disabled  — disables every chip in the group
 *
 * Events:
 *   change — fires when the active value(s) change.
 *     detail.value is `string` for selection="single" (or null when none)
 *     detail.value is `string[]` for selection="multiple".
 *
 * Keyboard:
 *   ArrowLeft / ArrowRight — move focus across enabled chips
 *   Home / End — jump to first/last enabled chip
 *   Space / Enter — toggle the focused chip (handled inside <atlas-chip>)
 */

type SelectionMode = 'single' | 'multiple' | 'none';

export interface AtlasChipGroupChangeDetail {
  value: string | string[] | null;
}

export class AtlasChipGroup extends AtlasElement {
  declare selection: string;
  declare disabled: boolean;

  static {
    Object.defineProperty(this.prototype, 'selection', AtlasElement.strAttr('selection', 'single'));
    Object.defineProperty(this.prototype, 'disabled',  AtlasElement.boolAttr('disabled'));
  }

  static override get observedAttributes(): readonly string[] {
    return ['selection', 'disabled'];
  }

  private _wired = false;
  private _onChipChange = (e: Event): void => this._handleChipChange(e);
  private _onKey = (e: KeyboardEvent): void => this._handleKey(e);

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'group');
    if (!this.hasAttribute('aria-label') && !this.hasAttribute('aria-labelledby')) {
      // Ensure SR users get *something* meaningful even if the consumer
      // forgot to label the group; "chips" is generic but better than empty.
      this.setAttribute('aria-label', 'Chips');
    }
    this._wire();
    this._syncDisabled();
    this._enforceSelectionMode();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('change', this._onChipChange);
    this.removeEventListener('keydown', this._onKey);
    this._wired = false;
  }

  override attributeChangedCallback(name: string): void {
    if (!this.isConnected) return;
    if (name === 'selection') this._enforceSelectionMode();
    if (name === 'disabled') this._syncDisabled();
  }

  private _mode(): SelectionMode {
    const v = this.getAttribute('selection') ?? 'single';
    if (v === 'multiple' || v === 'none') return v;
    return 'single';
  }

  private _chips(): HTMLElement[] {
    return Array.from(this.querySelectorAll<HTMLElement>(':scope > atlas-chip'));
  }

  private _wire(): void {
    if (this._wired) return;
    // Listen at the group level for chip change events. Using the
    // bubble phase means slot reassignments / DOM changes don't break us.
    this.addEventListener('change', this._onChipChange);
    this.addEventListener('keydown', this._onKey);
    this._wired = true;
  }

  private _syncDisabled(): void {
    const off = this.hasAttribute('disabled');
    for (const chip of this._chips()) {
      if (off) chip.setAttribute('disabled', '');
      else chip.removeAttribute('disabled');
    }
  }

  /**
   * If the consumer flips selection to "single" while >1 chip is selected,
   * we keep the first selected chip and clear the rest.
   */
  private _enforceSelectionMode(): void {
    const mode = this._mode();
    if (mode === 'none') {
      for (const c of this._chips()) c.removeAttribute('selected');
      return;
    }
    if (mode === 'single') {
      const selected = this._chips().filter((c) => c.hasAttribute('selected'));
      for (let i = 1; i < selected.length; i++) {
        const chip = selected[i];
        if (chip) chip.removeAttribute('selected');
      }
    }
  }

  private _handleChipChange(e: Event): void {
    const target = e.target as HTMLElement | null;
    if (!target || target.tagName.toLowerCase() !== 'atlas-chip') return;
    if (target.parentElement !== this) return;

    const mode = this._mode();
    if (mode === 'none') {
      // Group does not coordinate selection. Pass through but don't emit.
      return;
    }

    if (mode === 'single' && target.hasAttribute('selected')) {
      // Clear other selections; this chip wins.
      for (const c of this._chips()) {
        if (c !== target && c.hasAttribute('selected')) c.removeAttribute('selected');
      }
    }

    const detail: AtlasChipGroupChangeDetail = { value: this._currentValue() };
    this.dispatchEvent(
      new CustomEvent<AtlasChipGroupChangeDetail>('change', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );

    const name = this.getAttribute('name');
    if (this.surfaceId && name) {
      this.emit(`${this.surfaceId}.${name}-changed`, { value: detail.value });
    }
  }

  private _currentValue(): string | string[] | null {
    const mode = this._mode();
    const chips = this._chips();
    const selected = chips.filter((c) => c.hasAttribute('selected'));
    if (mode === 'multiple') {
      return selected.map((c) => c.getAttribute('value') ?? c.textContent?.trim() ?? '');
    }
    if (mode === 'single') {
      const first = selected[0];
      if (!first) return null;
      return first.getAttribute('value') ?? first.textContent?.trim() ?? '';
    }
    return null;
  }

  /** Public read of current selection (matches `change` detail shape). */
  get value(): string | string[] | null {
    return this._currentValue();
  }
  set value(next: string | string[] | null | undefined) {
    const mode = this._mode();
    const chips = this._chips();
    const wanted = new Set<string>();
    if (Array.isArray(next)) for (const v of next) wanted.add(String(v));
    else if (next != null) wanted.add(String(next));

    if (mode === 'none') {
      for (const c of chips) c.removeAttribute('selected');
      return;
    }
    let firstSeen = false;
    for (const c of chips) {
      const cv = c.getAttribute('value') ?? c.textContent?.trim() ?? '';
      if (wanted.has(cv) && (mode === 'multiple' || !firstSeen)) {
        c.setAttribute('selected', '');
        if (mode === 'single') firstSeen = true;
      } else {
        c.removeAttribute('selected');
      }
    }
  }

  private _handleKey(e: KeyboardEvent): void {
    if (e.defaultPrevented) return;
    const enabled = this._chips().filter((c) => !c.hasAttribute('disabled'));
    if (enabled.length === 0) return;
    // Find which chip currently owns focus (or contains the active element
    // through its shadow root).
    const active = (this.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null;
    const idx = enabled.findIndex((c) => c === active || c.contains(active));
    if (idx < 0) return;

    let next = -1;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (idx + 1) % enabled.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (idx - 1 + enabled.length) % enabled.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = enabled.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const target = enabled[next];
    if (!target) return;
    // Focus the chip's host; the inner <button> picks up focus through
    // delegatesFocus-like semantics via shadow root. Since we did not opt
    // into delegatesFocus, focus the inner button explicitly.
    const innerBtn =
      target.shadowRoot?.querySelector<HTMLButtonElement>('button.chip') ?? null;
    (innerBtn ?? target).focus();
  }
}

AtlasElement.define('atlas-chip-group', AtlasChipGroup);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-chip-group': AtlasChipGroup;
  }
}
