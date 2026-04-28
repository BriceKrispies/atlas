import { AtlasElement } from '@atlas/core';

/**
 * <atlas-stepper> — multi-step progress indicator.
 *
 * Composed of `<atlas-step>` children. The stepper itself is light DOM
 * (the <ol> equivalent: `role="list"`); CSS in elements.css drives both
 * the dot/connector geometry and the orientation switch.
 *
 * Attributes:
 *   orientation — horizontal (default) | vertical. Horizontal auto-switches
 *                 to vertical at ≤640px via a CSS rule that targets the
 *                 default (no orientation attr) — explicit orientation
 *                 wins.
 *   clickable   — when present, each step's dot becomes a focusable button
 *                 and emits `step-click` on activation.
 *
 * Events:
 *   step-click → CustomEvent<{ value: string }>  (only when `clickable`)
 *
 * Accessibility:
 *   role="list" on parent, role="listitem" on each step (set by the
 *   step element itself). The step at status="current" sets
 *   aria-current="step".
 */
export class AtlasStepper extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['clickable', 'orientation'];
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'list');
    this._propagate();
    this.addEventListener('click', this._onClick);
    this.addEventListener('keydown', this._onKeydown);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('click', this._onClick);
    this.removeEventListener('keydown', this._onKeydown);
  }

  override attributeChangedCallback(name: string): void {
    if (name === 'clickable' || name === 'orientation') this._propagate();
  }

  private _propagate(): void {
    // Mark each child step with its index (for the visible numeral) and
    // whether it's clickable. Steps render their own internals; we only
    // touch `data-*` here.
    const steps = this._steps();
    const clickable = this.hasAttribute('clickable');
    steps.forEach((step, i) => {
      step.setAttribute('data-index', String(i + 1));
      if (clickable) step.setAttribute('data-clickable', '');
      else step.removeAttribute('data-clickable');
      // Last step gets a marker so the connector line is hidden.
      if (i === steps.length - 1) step.setAttribute('data-last', '');
      else step.removeAttribute('data-last');
    });
  }

  private _steps(): Element[] {
    return Array.from(this.querySelectorAll(':scope > atlas-step'));
  }

  private readonly _onClick = (ev: Event): void => {
    if (!this.hasAttribute('clickable')) return;
    const path = ev.composedPath();
    for (const node of path) {
      if (node instanceof Element && node.tagName.toLowerCase() === 'atlas-step') {
        if (node.parentElement !== this) return;
        if (node.hasAttribute('disabled')) return;
        const value = node.getAttribute('value') ?? '';
        this.dispatchEvent(
          new CustomEvent<{ value: string }>('step-click', {
            detail: { value },
            bubbles: true,
            composed: true,
          }),
        );
        const elName = this.getAttribute('name');
        if (elName && this.surfaceId) this.emit(`${this.surfaceId}.${elName}-clicked`, { value });
        return;
      }
    }
  };

  private readonly _onKeydown = (ev: KeyboardEvent): void => {
    if (!this.hasAttribute('clickable')) return;
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const step = target.closest('atlas-step');
    if (!step || step.parentElement !== this) return;
    if (step.hasAttribute('disabled')) return;
    ev.preventDefault();
    const value = step.getAttribute('value') ?? '';
    this.dispatchEvent(
      new CustomEvent<{ value: string }>('step-click', {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
    const elName = this.getAttribute('name');
    if (elName && this.surfaceId) this.emit(`${this.surfaceId}.${elName}-clicked`, { value });
  };
}

AtlasElement.define('atlas-stepper', AtlasStepper);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-stepper': AtlasStepper;
  }
}
