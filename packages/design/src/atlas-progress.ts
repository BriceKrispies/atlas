import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-progress> — determinate (or indeterminate) progress bar.
 *
 * Visually a track with a coloured fill. Sets `role="progressbar"` and
 * keeps `aria-valuemin`, `aria-valuemax`, `aria-valuenow` in sync. When
 * `indeterminate` is set the bar animates a sliding chip and ARIA's
 * `aria-valuenow` is dropped (per WAI-ARIA, indeterminate progress
 * elements omit valuenow).
 *
 * Attributes:
 *   value         — number 0..max (defaults to 0)
 *   max           — number, default 100
 *   variant       — default | success | warning | danger
 *   indeterminate — boolean; hides the readout, shows a sliding chip
 *   show-label    — boolean; renders a "47%" caption to the right
 *   size          — sm | md (default md)
 *   label         — accessible name; mirrored to aria-label when present
 *
 * Reduced-motion: the indeterminate animation is replaced by a static
 * 40%-wide bar with a soft pulse, satisfying R7.1 without dropping the
 * "still working" semantic that motion is communicating.
 */

const sheet = createSheet(`
  :host {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-sm);
    width: 100%;
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-xs);
    color: var(--atlas-color-text-muted);
  }
  .track {
    position: relative;
    flex: 1 1 auto;
    height: 8px;
    background: var(--atlas-color-surface);
    border-radius: 999px;
    overflow: hidden;
    /* Border so the track has a defined edge against any background. */
    border: 1px solid var(--atlas-color-border);
  }
  :host([size="sm"]) .track {
    height: 4px;
  }
  .fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: 0%;
    background: var(--atlas-color-primary);
    border-radius: inherit;
    transition: width var(--atlas-transition-fast);
  }
  :host([variant="success"]) .fill { background: var(--atlas-color-success-text, #2e7d32); }
  :host([variant="warning"]) .fill { background: var(--atlas-color-warning-text, #b26a00); }
  :host([variant="danger"])  .fill { background: var(--atlas-color-danger); }

  .label {
    flex: 0 0 auto;
    min-width: 3ch;
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--atlas-color-text);
  }

  /* Indeterminate: slide a 40% chip across the track. */
  :host([indeterminate]) .fill {
    width: 40%;
    transition: none;
    animation: atlas-progress-slide 1.4s ease-in-out infinite;
  }
  @keyframes atlas-progress-slide {
    0%   { transform: translateX(-110%); }
    100% { transform: translateX(260%); }
  }
  @media (prefers-reduced-motion: reduce) {
    /* Replace the slide with a soft opacity pulse so motion-sensitive
       users still see "something is happening" without sweeping motion. */
    :host([indeterminate]) .fill {
      animation: atlas-progress-pulse 2s ease-in-out infinite;
      transform: none;
      width: 40%;
      left: 30%;
    }
    @keyframes atlas-progress-pulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.45; }
    }
    .fill { transition: none; }
  }
`);

export class AtlasProgress extends AtlasElement {
  declare value: string;
  declare max: string;
  declare variant: string;
  declare indeterminate: boolean;
  declare size: string;
  declare label: string;

  static {
    Object.defineProperty(this.prototype, 'value', AtlasElement.strAttr('value', '0'));
    Object.defineProperty(this.prototype, 'max', AtlasElement.strAttr('max', '100'));
    Object.defineProperty(this.prototype, 'variant', AtlasElement.strAttr('variant', 'default'));
    Object.defineProperty(this.prototype, 'indeterminate', AtlasElement.boolAttr('indeterminate'));
    Object.defineProperty(this.prototype, 'size', AtlasElement.strAttr('size', 'md'));
    Object.defineProperty(this.prototype, 'label', AtlasElement.strAttr('label', ''));
  }

  static override get observedAttributes(): readonly string[] {
    return ['value', 'max', 'indeterminate', 'show-label', 'label'];
  }

  private _built = false;
  private _track: HTMLDivElement | null = null;
  private _fill: HTMLDivElement | null = null;
  private _labelEl: HTMLDivElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'progressbar');
    if (!this._built) this._buildShell();
    this._syncAll();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'label') {
      this._syncAriaLabel();
      return;
    }
    this._syncAria();
    this._syncFill();
    this._syncLabel();
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const track = document.createElement('div');
    track.className = 'track';
    const fill = document.createElement('div');
    fill.className = 'fill';
    track.appendChild(fill);
    const labelEl = document.createElement('div');
    labelEl.className = 'label';
    labelEl.hidden = true;
    root.appendChild(track);
    root.appendChild(labelEl);
    this._track = track;
    this._fill = fill;
    this._labelEl = labelEl;
    this._built = true;
  }

  private _syncAll(): void {
    this._syncAriaLabel();
    this._syncAria();
    this._syncFill();
    this._syncLabel();
  }

  private _readNumber(name: string, fallback: number): number {
    const raw = this.getAttribute(name);
    if (raw == null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return n;
  }

  private _currentValue(): number {
    const max = Math.max(0, this._readNumber('max', 100));
    const v = this._readNumber('value', 0);
    return Math.max(0, Math.min(max, v));
  }

  private _percent(): number {
    const max = Math.max(0, this._readNumber('max', 100));
    if (max === 0) return 0;
    const v = this._currentValue();
    return Math.round((v / max) * 100);
  }

  private _syncAria(): void {
    const max = Math.max(0, this._readNumber('max', 100));
    const indeterminate = this.hasAttribute('indeterminate');
    this.setAttribute('aria-valuemin', '0');
    this.setAttribute('aria-valuemax', String(max));
    if (indeterminate) {
      this.removeAttribute('aria-valuenow');
    } else {
      this.setAttribute('aria-valuenow', String(this._currentValue()));
    }
  }

  private _syncAriaLabel(): void {
    const label = this.getAttribute('label');
    if (label) this.setAttribute('aria-label', label);
  }

  private _syncFill(): void {
    if (!this._fill) return;
    const indeterminate = this.hasAttribute('indeterminate');
    if (indeterminate) {
      // Width is set by CSS in indeterminate mode; clear inline style.
      this._fill.style.width = '';
      return;
    }
    this._fill.style.width = `${this._percent()}%`;
  }

  private _syncLabel(): void {
    if (!this._labelEl) return;
    const show = this.hasAttribute('show-label');
    const indeterminate = this.hasAttribute('indeterminate');
    if (!show || indeterminate) {
      this._labelEl.hidden = true;
      this._labelEl.textContent = '';
      return;
    }
    this._labelEl.hidden = false;
    this._labelEl.textContent = `${this._percent()}%`;
  }
}

AtlasElement.define('atlas-progress', AtlasProgress);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-progress': AtlasProgress;
  }
}
