import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeAttr, escapeText, uid } from './util.ts';

/**
 * `<atlas-color-picker>` — form-associated color input.
 *
 * UI: a swatch trigger button that opens a panel containing
 *   - SV (saturation × value) square — pointer-drag, ArrowKeys when focused.
 *   - Hue slider — pointer-drag, ArrowLeft/Right when focused.
 *   - Optional alpha slider (when `alpha` is set).
 *   - Hex text input — typed entry committed on Enter / blur.
 *   - Preset swatch row from the comma-separated `swatches` attribute.
 *
 * Attributes:
 *   value      — committed colour. Always reflected as `#rrggbb` (or
 *                `#rrggbbaa` when `alpha` is on). The `format` attribute
 *                only changes the value the `change` event reports.
 *   format     — "hex" (default) | "rgb" | "hsl" — output format on
 *                `change`. Internal storage stays canonical hex so the
 *                form-associated value is unambiguous.
 *   swatches   — comma-separated hex list, e.g. "#0f62fe,#ff5630,#36b37e"
 *   alpha      — boolean. Shows the alpha track and reports rgba/hsla.
 *   disabled   — boolean.
 *   label      — required (C3.2) — renders a visible <label>.
 *   name       — required for form submission and auto-testid emit.
 *   required   — boolean. Empty value triggers valueMissing when set.
 *
 * Events:
 *   input  → every drag tick (intermediate)
 *   change → on commit (pointer-up, swatch click, hex Enter, hex blur)
 *
 * Form-associated: submits the canonical hex string via ElementInternals.
 *
 * Colour math is in-file. No third-party library:
 *   • hex ↔ rgb is bytewise exact.
 *   • rgb → hsl uses the standard formulation (Foley/van Dam, also
 *     mirrored by CSS Color Module Level 4 §6.4); hsl → rgb is the
 *     classic 1-chroma reverse. Round-trips are stable to within 1 hex
 *     step (≤ 1/255 per channel) which is below human-perceptible
 *     threshold for an 8-bit display.
 *   • Internally the picker holds HSV (intuitive SV-square model) and
 *     converts to RGB on commit; HSV→RGB is exact in floating point.
 */

const sheet = createSheet(`
  :host {
    display: inline-block;
    font-family: var(--atlas-font-family);
    position: relative;
  }
  label.legend {
    display: block;
    font-size: var(--atlas-font-size-sm);
    font-weight: var(--atlas-font-weight-medium);
    color: var(--atlas-color-text);
    margin-bottom: var(--atlas-space-xs);
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--atlas-space-sm);
    padding: 4px var(--atlas-space-sm) 4px 4px;
    min-height: var(--atlas-touch-target-min, 44px);
    min-width: var(--atlas-touch-target-min, 44px);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    font-family: inherit;
    font-size: var(--atlas-font-size-sm);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    box-sizing: border-box;
  }
  .trigger:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  .trigger:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .swatch {
    display: inline-block;
    width: 36px;
    height: 36px;
    border-radius: var(--atlas-radius-sm);
    /* Checkerboard for transparent colours. */
    background-image:
      linear-gradient(45deg, #d0d0d0 25%, transparent 25%),
      linear-gradient(-45deg, #d0d0d0 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #d0d0d0 75%),
      linear-gradient(-45deg, transparent 75%, #d0d0d0 75%);
    background-size: 12px 12px;
    background-position: 0 0, 0 6px, 6px -6px, -6px 0;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
    position: relative;
    overflow: hidden;
  }
  .swatch::after {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--swatch-color, transparent);
  }

  .panel {
    position: absolute;
    z-index: 50;
    top: calc(100% + 4px);
    left: 0;
    width: min(280px, calc(100vw - 32px));
    padding: var(--atlas-space-md);
    background: var(--atlas-color-bg);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    box-shadow: var(--atlas-shadow-lg, 0 10px 30px rgba(0, 0, 0, 0.18));
    display: none;
  }
  :host([open]) .panel { display: block; }

  .sv {
    position: relative;
    width: 100%;
    height: 160px;
    border-radius: var(--atlas-radius-sm);
    cursor: crosshair;
    touch-action: none;
    /* Hue baseline overridden via --hue-color inline. */
    background:
      linear-gradient(to top, #000, transparent),
      linear-gradient(to right, #fff, var(--hue-color, #f00));
    outline: none;
  }
  .sv:focus-visible {
    box-shadow: 0 0 0 2px var(--atlas-color-primary);
  }
  .sv .dot {
    position: absolute;
    width: 14px;
    height: 14px;
    margin-left: -7px;
    margin-top: -7px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
    pointer-events: none;
  }

  .track {
    position: relative;
    height: 14px;
    margin-top: var(--atlas-space-sm);
    border-radius: 7px;
    cursor: pointer;
    touch-action: none;
    outline: none;
  }
  .track:focus-visible {
    box-shadow: 0 0 0 2px var(--atlas-color-primary);
  }
  .track.hue {
    background: linear-gradient(
      to right,
      #f00 0%, #ff0 16.66%, #0f0 33.33%, #0ff 50%, #00f 66.66%, #f0f 83.33%, #f00 100%
    );
  }
  .track.alpha {
    background-image:
      linear-gradient(to right, transparent, var(--alpha-color, #000)),
      linear-gradient(45deg, #d0d0d0 25%, transparent 25%),
      linear-gradient(-45deg, #d0d0d0 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #d0d0d0 75%),
      linear-gradient(-45deg, transparent 75%, #d0d0d0 75%);
    background-size: 100% 100%, 8px 8px, 8px 8px, 8px 8px, 8px 8px;
    background-position: 0 0, 0 0, 0 4px, 4px -4px, -4px 0;
  }
  .track .thumb {
    position: absolute;
    top: 50%;
    width: 14px;
    height: 14px;
    margin-left: -7px;
    margin-top: -7px;
    border-radius: 50%;
    background: var(--atlas-color-bg);
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
    pointer-events: none;
  }

  .row {
    display: flex;
    gap: var(--atlas-space-sm);
    align-items: center;
    margin-top: var(--atlas-space-sm);
  }
  .row .preview {
    flex: 0 0 auto;
    width: 32px;
    height: 32px;
    border-radius: var(--atlas-radius-sm);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
    background-image:
      linear-gradient(45deg, #d0d0d0 25%, transparent 25%),
      linear-gradient(-45deg, #d0d0d0 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #d0d0d0 75%),
      linear-gradient(-45deg, transparent 75%, #d0d0d0 75%);
    background-size: 8px 8px;
    background-position: 0 0, 0 4px, 4px -4px, -4px 0;
    position: relative;
    overflow: hidden;
  }
  .row .preview::after {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--preview-color, transparent);
  }
  .row input.hex {
    flex: 1 1 auto;
    min-height: 36px;
    padding: 6px var(--atlas-space-sm);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-sm);
    font-family: var(--atlas-font-mono, monospace);
    font-size: max(13px, var(--atlas-font-size-sm));
    text-transform: uppercase;
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    box-sizing: border-box;
  }
  .row input.hex:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -1px;
  }

  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(28px, 1fr));
    gap: 6px;
    margin-top: var(--atlas-space-sm);
  }
  .swatches button {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    min-width: 28px;
    min-height: 28px;
    padding: 0;
    border-radius: var(--atlas-radius-sm);
    border: 1px solid rgba(0, 0, 0, 0.15);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  /* C16/R3: real touch surface even when visual size shrinks. */
  @media (pointer: coarse) {
    .swatches button { min-width: 44px; min-height: 44px; }
  }
  .swatches button:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
  .swatches button[aria-checked="true"]::after {
    /* C3.11: non-colour indicator for the selected swatch. */
    content: "";
    position: absolute;
    inset: 25%;
    border-left: 2px solid #fff;
    border-bottom: 2px solid #fff;
    transform: rotate(-45deg);
    filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.7));
  }
`);

export interface AtlasColorPickerChangeDetail {
  /** Reported in the format the `format` attribute requests. */
  value: string;
  /** Always supplied, regardless of `format`, for callers that need it. */
  hex: string;
}

interface Hsv { h: number; s: number; v: number }
interface Rgb { r: number; g: number; b: number }

const HEX6_RE = /^#?([0-9a-f]{6})$/i;
const HEX8_RE = /^#?([0-9a-f]{8})$/i;
const HEX3_RE = /^#?([0-9a-f]{3})$/i;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function pad2(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return v.toString(16).padStart(2, '0');
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${pad2(r)}${pad2(g)}${pad2(b)}`;
}

function hexToRgb(input: string): Rgb | null {
  const six = HEX6_RE.exec(input);
  if (six && six[1]) {
    const h = six[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  const eight = HEX8_RE.exec(input);
  if (eight && eight[1]) {
    const h = eight[1];
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  const three = HEX3_RE.exec(input);
  if (three && three[1]) {
    const h = three[1];
    const c0 = h[0] ?? '0';
    const c1 = h[1] ?? '0';
    const c2 = h[2] ?? '0';
    return {
      r: parseInt(c0 + c0, 16),
      g: parseInt(c1 + c1, 16),
      b: parseInt(c2 + c2, 16),
    };
  }
  return null;
}

function hexAlpha(input: string): number {
  const eight = HEX8_RE.exec(input);
  if (eight && eight[1]) return parseInt(eight[1].slice(6, 8), 16) / 255;
  return 1;
}

function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rf)      h = ((gf - bf) / d) % 6;
    else if (max === gf) h = (bf - rf) / d + 2;
    else                 h = (rf - gf) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if      (hp < 1) { r1 = c; g1 = x; }
  else if (hp < 2) { r1 = x; g1 = c; }
  else if (hp < 3) { g1 = c; b1 = x; }
  else if (hp < 4) { g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; b1 = c; }
  else             { r1 = c; b1 = x; }
  const m = v - c;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const d = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rf)      h = ((gf - bf) / d) % 6;
    else if (max === gf) h = (bf - rf) / d + 2;
    else                 h = (rf - gf) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, l };
}

function formatRgb(rgb: Rgb, alpha: number, includeAlpha: boolean): string {
  if (includeAlpha && alpha < 1) {
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Number(alpha.toFixed(3))})`;
  }
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

function formatHsl(rgb: Rgb, alpha: number, includeAlpha: boolean): string {
  const { h, s, l } = rgbToHsl(rgb);
  const hh = Math.round(h);
  const ss = Math.round(s * 100);
  const ll = Math.round(l * 100);
  if (includeAlpha && alpha < 1) {
    return `hsla(${hh}, ${ss}%, ${ll}%, ${Number(alpha.toFixed(3))})`;
  }
  return `hsl(${hh}, ${ss}%, ${ll}%)`;
}

function parseSwatchList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && hexToRgb(s) !== null)
    .map((s) => {
      const rgb = hexToRgb(s);
      return rgb ? rgbToHex(rgb).toLowerCase() : s.toLowerCase();
    });
}

const DEFAULT_VALUE = '#000000';

export class AtlasColorPicker extends AtlasElement {
  static formAssociated = true;

  static override get observedAttributes(): readonly string[] {
    return [
      'label',
      'value',
      'format',
      'swatches',
      'alpha',
      'disabled',
      'required',
    ];
  }

  declare disabled: boolean;
  declare required: boolean;
  declare alpha: boolean;

  static {
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
    Object.defineProperty(this.prototype, 'required', AtlasElement.boolAttr('required'));
    Object.defineProperty(this.prototype, 'alpha',    AtlasElement.boolAttr('alpha'));
  }

  private readonly _triggerId = uid('atlas-cp-trg');
  private readonly _internals: ElementInternals;
  private _built = false;

  // Internal model — HSV makes the SV-square + hue slider intuitive; we
  // convert to RGB/hex on commit.
  private _hsv: Hsv = { h: 0, s: 0, v: 0 };
  private _alphaVal = 1;

  // DOM refs
  private _legend: HTMLLabelElement | null = null;
  private _trigger: HTMLButtonElement | null = null;
  private _triggerSwatch: HTMLSpanElement | null = null;
  private _panel: HTMLDivElement | null = null;
  private _sv: HTMLDivElement | null = null;
  private _svDot: HTMLSpanElement | null = null;
  private _hueTrack: HTMLDivElement | null = null;
  private _hueThumb: HTMLSpanElement | null = null;
  private _alphaTrack: HTMLDivElement | null = null;
  private _alphaThumb: HTMLSpanElement | null = null;
  private _hexInput: HTMLInputElement | null = null;
  private _previewBox: HTMLSpanElement | null = null;
  private _swatchRow: HTMLDivElement | null = null;

  private _outsideHandler: ((ev: MouseEvent) => void) | null = null;
  private _docKeyHandler: ((ev: KeyboardEvent) => void) | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
    this._internals = this.attachInternals();
  }

  // -- Public API -----------------------------------------------------

  get value(): string {
    return this._currentHex();
  }
  set value(v: string) {
    if (typeof v !== 'string') return;
    this._setFromHex(v, /*emit*/ false);
    this.setAttribute('value', this._currentHex());
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._readModelFromAttribute();
    this._syncAll();
    this._commit(/*emit*/ false);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._tearDownOutside();
  }

  override attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (!this._built) return;
    if (oldVal === newVal) return;
    this._sync(name);
  }

  // -- Build / sync ---------------------------------------------------

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;

    const label = this.getAttribute('label') ?? '';
    root.innerHTML = `
      ${
        label
          ? `<label class="legend" for="${escapeAttr(this._triggerId)}">${escapeText(label)}</label>`
          : ''
      }
      <button type="button" class="trigger" id="${escapeAttr(this._triggerId)}"
              aria-haspopup="dialog" aria-expanded="false">
        <span class="swatch" aria-hidden="true"></span>
        <span class="hex-readout" aria-live="polite">#000000</span>
      </button>
      <div class="panel" role="dialog" aria-label="Choose colour">
        <div class="sv" tabindex="0" role="slider"
             aria-label="Saturation and value"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span class="dot"></span>
        </div>
        <div class="track hue" tabindex="0" role="slider"
             aria-label="Hue"
             aria-valuemin="0" aria-valuemax="360" aria-valuenow="0">
          <span class="thumb"></span>
        </div>
        <div class="track alpha" tabindex="0" role="slider"
             aria-label="Alpha"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"
             hidden>
          <span class="thumb"></span>
        </div>
        <div class="row">
          <span class="preview" aria-hidden="true"></span>
          <input class="hex" type="text" inputmode="text" spellcheck="false"
                 autocapitalize="off" autocorrect="off"
                 aria-label="Hex value" maxlength="9" />
        </div>
        <div class="swatches" role="radiogroup" aria-label="Preset swatches"></div>
      </div>
    `;

    this._legend       = root.querySelector<HTMLLabelElement>('label.legend');
    this._trigger      = root.querySelector<HTMLButtonElement>('.trigger');
    this._triggerSwatch = root.querySelector<HTMLSpanElement>('.trigger .swatch');
    this._panel        = root.querySelector<HTMLDivElement>('.panel');
    this._sv           = root.querySelector<HTMLDivElement>('.sv');
    this._svDot        = root.querySelector<HTMLSpanElement>('.sv .dot');
    this._hueTrack     = root.querySelector<HTMLDivElement>('.track.hue');
    this._hueThumb     = root.querySelector<HTMLSpanElement>('.track.hue .thumb');
    this._alphaTrack   = root.querySelector<HTMLDivElement>('.track.alpha');
    this._alphaThumb   = root.querySelector<HTMLSpanElement>('.track.alpha .thumb');
    this._hexInput     = root.querySelector<HTMLInputElement>('input.hex');
    this._previewBox   = root.querySelector<HTMLSpanElement>('.row .preview');
    this._swatchRow    = root.querySelector<HTMLDivElement>('.swatches');

    this._wireTrigger();
    this._wireSv();
    this._wireHue();
    this._wireAlpha();
    this._wireHex();
    this._wireSwatches();

    this._built = true;
  }

  private _readModelFromAttribute(): void {
    const raw = this.getAttribute('value');
    if (raw && raw.length > 0) {
      const rgb = hexToRgb(raw);
      if (rgb) {
        this._hsv = rgbToHsv(rgb);
        this._alphaVal = hexAlpha(raw);
        return;
      }
    }
    const def = hexToRgb(DEFAULT_VALUE);
    if (def) {
      this._hsv = rgbToHsv(def);
      this._alphaVal = 1;
    }
  }

  private _syncAll(): void {
    this._sync('label');
    this._sync('alpha');
    this._sync('disabled');
    this._sync('swatches');
    this._renderUi();
  }

  private _sync(name: string): void {
    const root = this.shadowRoot;
    if (!root) return;
    switch (name) {
      case 'label':
        this._syncLabel();
        break;
      case 'value': {
        // Only adopt attribute when it actually drifts from internal model.
        const want = this.getAttribute('value');
        if (!want) return;
        const current = this._currentHex();
        if (want.toLowerCase() === current.toLowerCase()) return;
        this._setFromHex(want, /*emit*/ false);
        this._renderUi();
        this._commit(/*emit*/ false);
        break;
      }
      case 'alpha': {
        if (this._alphaTrack) {
          if (this.alpha) this._alphaTrack.removeAttribute('hidden');
          else this._alphaTrack.setAttribute('hidden', '');
        }
        if (!this.alpha) this._alphaVal = 1;
        this._renderUi();
        this._commit(/*emit*/ false);
        break;
      }
      case 'disabled': {
        if (this._trigger) this._trigger.disabled = this.disabled;
        if (this.disabled) this._closePanel();
        break;
      }
      case 'swatches':
      case 'format':
      case 'required':
        this._renderUi();
        this._commit(/*emit*/ false);
        break;
    }
  }

  private _syncLabel(): void {
    const root = this.shadowRoot;
    if (!root || !this._trigger) return;
    const label = this.getAttribute('label') ?? '';
    if (label) {
      if (!this._legend) {
        const lbl = document.createElement('label');
        lbl.className = 'legend';
        lbl.setAttribute('for', this._triggerId);
        root.insertBefore(lbl, this._trigger);
        this._legend = lbl;
      }
      this._legend.textContent = label;
    } else if (this._legend) {
      this._legend.remove();
      this._legend = null;
    }
  }

  // -- Wiring ---------------------------------------------------------

  private _wireTrigger(): void {
    const btn = this._trigger;
    if (!btn) return;
    btn.addEventListener('click', () => {
      if (this.disabled) return;
      this.hasAttribute('open') ? this._closePanel() : this._openPanel();
    });
    btn.addEventListener('keydown', (ev) => {
      if (this.disabled) return;
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        this._openPanel();
      }
    });
  }

  private _wireSv(): void {
    const sv = this._sv;
    if (!sv) return;
    const onPointer = (ev: PointerEvent): void => {
      const rect = sv.getBoundingClientRect();
      const x = clamp01((ev.clientX - rect.left) / rect.width);
      const y = clamp01((ev.clientY - rect.top) / rect.height);
      this._hsv.s = x;
      this._hsv.v = 1 - y;
      this._renderUi();
      this._commit(/*emit*/ true, /*intermediate*/ true);
    };
    sv.addEventListener('pointerdown', (ev) => {
      if (this.disabled) return;
      sv.setPointerCapture(ev.pointerId);
      onPointer(ev);
    });
    sv.addEventListener('pointermove', (ev) => {
      if (!sv.hasPointerCapture(ev.pointerId)) return;
      onPointer(ev);
    });
    sv.addEventListener('pointerup', (ev) => {
      if (sv.hasPointerCapture(ev.pointerId)) sv.releasePointerCapture(ev.pointerId);
      this._commit(/*emit*/ true, /*intermediate*/ false);
    });
    sv.addEventListener('keydown', (ev) => {
      if (this.disabled) return;
      const step = ev.shiftKey ? 0.1 : 0.02;
      let handled = true;
      switch (ev.key) {
        case 'ArrowRight': this._hsv.s = clamp01(this._hsv.s + step); break;
        case 'ArrowLeft':  this._hsv.s = clamp01(this._hsv.s - step); break;
        case 'ArrowUp':    this._hsv.v = clamp01(this._hsv.v + step); break;
        case 'ArrowDown':  this._hsv.v = clamp01(this._hsv.v - step); break;
        case 'Home':       this._hsv.s = 0; break;
        case 'End':        this._hsv.s = 1; break;
        default: handled = false;
      }
      if (!handled) return;
      ev.preventDefault();
      this._renderUi();
      this._commit(/*emit*/ true, /*intermediate*/ false);
    });
  }

  private _wireHue(): void {
    const tr = this._hueTrack;
    if (!tr) return;
    const onPointer = (ev: PointerEvent): void => {
      const rect = tr.getBoundingClientRect();
      const x = clamp01((ev.clientX - rect.left) / rect.width);
      this._hsv.h = x * 360;
      this._renderUi();
      this._commit(/*emit*/ true, /*intermediate*/ true);
    };
    tr.addEventListener('pointerdown', (ev) => {
      if (this.disabled) return;
      tr.setPointerCapture(ev.pointerId);
      onPointer(ev);
    });
    tr.addEventListener('pointermove', (ev) => {
      if (!tr.hasPointerCapture(ev.pointerId)) return;
      onPointer(ev);
    });
    tr.addEventListener('pointerup', (ev) => {
      if (tr.hasPointerCapture(ev.pointerId)) tr.releasePointerCapture(ev.pointerId);
      this._commit(/*emit*/ true, /*intermediate*/ false);
    });
    tr.addEventListener('keydown', (ev) => {
      if (this.disabled) return;
      const step = ev.shiftKey ? 30 : 6;
      let handled = true;
      switch (ev.key) {
        case 'ArrowRight': this._hsv.h = (this._hsv.h + step) % 360; break;
        case 'ArrowLeft':  this._hsv.h = (this._hsv.h - step + 360) % 360; break;
        case 'Home':       this._hsv.h = 0; break;
        case 'End':        this._hsv.h = 359; break;
        default: handled = false;
      }
      if (!handled) return;
      ev.preventDefault();
      this._renderUi();
      this._commit(/*emit*/ true, /*intermediate*/ false);
    });
  }

  private _wireAlpha(): void {
    const tr = this._alphaTrack;
    if (!tr) return;
    const onPointer = (ev: PointerEvent): void => {
      const rect = tr.getBoundingClientRect();
      const x = clamp01((ev.clientX - rect.left) / rect.width);
      this._alphaVal = x;
      this._renderUi();
      this._commit(/*emit*/ true, /*intermediate*/ true);
    };
    tr.addEventListener('pointerdown', (ev) => {
      if (this.disabled || !this.alpha) return;
      tr.setPointerCapture(ev.pointerId);
      onPointer(ev);
    });
    tr.addEventListener('pointermove', (ev) => {
      if (!tr.hasPointerCapture(ev.pointerId)) return;
      onPointer(ev);
    });
    tr.addEventListener('pointerup', (ev) => {
      if (tr.hasPointerCapture(ev.pointerId)) tr.releasePointerCapture(ev.pointerId);
      this._commit(/*emit*/ true, /*intermediate*/ false);
    });
    tr.addEventListener('keydown', (ev) => {
      if (this.disabled || !this.alpha) return;
      const step = ev.shiftKey ? 0.1 : 0.02;
      let handled = true;
      switch (ev.key) {
        case 'ArrowRight': this._alphaVal = clamp01(this._alphaVal + step); break;
        case 'ArrowLeft':  this._alphaVal = clamp01(this._alphaVal - step); break;
        case 'Home':       this._alphaVal = 0; break;
        case 'End':        this._alphaVal = 1; break;
        default: handled = false;
      }
      if (!handled) return;
      ev.preventDefault();
      this._renderUi();
      this._commit(/*emit*/ true, /*intermediate*/ false);
    });
  }

  private _wireHex(): void {
    const inp = this._hexInput;
    if (!inp) return;
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        this._commitHexInput();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        // Restore display from current model.
        inp.value = this._currentHex().toUpperCase();
      }
    });
    inp.addEventListener('blur', () => this._commitHexInput());
  }

  private _commitHexInput(): void {
    const inp = this._hexInput;
    if (!inp) return;
    const txt = inp.value.trim();
    if (txt === '') return;
    const ok = this._setFromHex(txt, /*emit*/ true);
    if (!ok) {
      // Revert to last good value.
      inp.value = this._currentHex().toUpperCase();
    }
  }

  private _wireSwatches(): void {
    const row = this._swatchRow;
    if (!row) return;
    row.addEventListener('click', (ev) => {
      const target = ev.target as Element | null;
      const btn = target?.closest<HTMLButtonElement>('button[data-hex]');
      if (!btn) return;
      const hex = btn.dataset['hex'];
      if (!hex) return;
      this._setFromHex(hex, /*emit*/ true);
    });
    row.addEventListener('keydown', (ev) => {
      const target = ev.target as Element | null;
      const btn = target?.closest<HTMLButtonElement>('button[data-hex]');
      if (!btn) return;
      const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>('button[data-hex]'));
      const idx = buttons.indexOf(btn);
      if (idx < 0) return;
      let next = -1;
      switch (ev.key) {
        case 'ArrowRight':
        case 'ArrowDown': next = (idx + 1) % buttons.length; break;
        case 'ArrowLeft':
        case 'ArrowUp':   next = (idx - 1 + buttons.length) % buttons.length; break;
        case 'Home': next = 0; break;
        case 'End':  next = buttons.length - 1; break;
        case 'Enter':
        case ' ': {
          ev.preventDefault();
          const hex = btn.dataset['hex'];
          if (hex) this._setFromHex(hex, /*emit*/ true);
          return;
        }
        default: return;
      }
      ev.preventDefault();
      const target2 = buttons[next];
      if (target2) target2.focus();
    });
  }

  // -- Open / close ---------------------------------------------------

  private _openPanel(): void {
    if (this.disabled) return;
    if (!this.hasAttribute('open')) this.setAttribute('open', '');
    if (this._trigger) this._trigger.setAttribute('aria-expanded', 'true');
    // Move focus into the panel so keyboard ops work immediately.
    queueMicrotask(() => this._sv?.focus());
    this._installOutside();
  }

  private _closePanel(): void {
    if (this.hasAttribute('open')) this.removeAttribute('open');
    if (this._trigger) this._trigger.setAttribute('aria-expanded', 'false');
    this._tearDownOutside();
  }

  private _installOutside(): void {
    if (this._outsideHandler) return;
    const onClick = (ev: MouseEvent): void => {
      const path = ev.composedPath();
      if (!path.includes(this)) this._closePanel();
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        this._closePanel();
        this._trigger?.focus();
      }
    };
    document.addEventListener('mousedown', onClick, true);
    document.addEventListener('keydown', onKey);
    this._outsideHandler = onClick;
    this._docKeyHandler = onKey;
  }

  private _tearDownOutside(): void {
    if (this._outsideHandler) {
      document.removeEventListener('mousedown', this._outsideHandler, true);
      this._outsideHandler = null;
    }
    if (this._docKeyHandler) {
      document.removeEventListener('keydown', this._docKeyHandler);
      this._docKeyHandler = null;
    }
  }

  // -- Render ---------------------------------------------------------

  private _renderUi(): void {
    if (!this._built) return;
    const rgb = hsvToRgb(this._hsv);
    const hex = rgbToHex(rgb);
    const hexUpper = hex.toUpperCase();
    const cssColor = this.alpha
      ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${this._alphaVal})`
      : hex;

    // Trigger swatch + readout
    if (this._triggerSwatch) {
      this._triggerSwatch.style.setProperty('--swatch-color', cssColor);
    }
    const readout = this._trigger?.querySelector<HTMLSpanElement>('.hex-readout');
    if (readout) readout.textContent = hexUpper;

    // SV square: hue background, dot position
    if (this._sv) {
      const hueRgb = hsvToRgb({ h: this._hsv.h, s: 1, v: 1 });
      this._sv.style.setProperty('--hue-color', rgbToHex(hueRgb));
      this._sv.setAttribute('aria-valuenow', String(Math.round(this._hsv.s * 100)));
      this._sv.setAttribute(
        'aria-valuetext',
        `Saturation ${Math.round(this._hsv.s * 100)}%, value ${Math.round(this._hsv.v * 100)}%`,
      );
    }
    if (this._svDot) {
      this._svDot.style.left = `${this._hsv.s * 100}%`;
      this._svDot.style.top = `${(1 - this._hsv.v) * 100}%`;
    }

    // Hue thumb
    if (this._hueTrack) {
      this._hueTrack.setAttribute('aria-valuenow', String(Math.round(this._hsv.h)));
    }
    if (this._hueThumb) {
      this._hueThumb.style.left = `${(this._hsv.h / 360) * 100}%`;
    }

    // Alpha
    if (this._alphaTrack) {
      this._alphaTrack.style.setProperty('--alpha-color', hex);
      this._alphaTrack.setAttribute(
        'aria-valuenow',
        String(Math.round(this._alphaVal * 100)),
      );
    }
    if (this._alphaThumb) {
      this._alphaThumb.style.left = `${this._alphaVal * 100}%`;
    }

    // Preview + hex input
    if (this._previewBox) {
      this._previewBox.style.setProperty('--preview-color', cssColor);
    }
    if (this._hexInput && document.activeElement !== this._hexInput) {
      this._hexInput.value = hexUpper;
    }

    // Swatches
    this._renderSwatches(hex.toLowerCase());
  }

  private _renderSwatches(currentHex: string): void {
    const row = this._swatchRow;
    if (!row) return;
    const list = parseSwatchList(this.getAttribute('swatches'));
    if (list.length === 0) {
      row.innerHTML = '';
      row.style.display = 'none';
      return;
    }
    row.style.display = '';
    let html = '';
    for (const hex of list) {
      const isSel = hex === currentHex;
      html += `<button type="button" role="radio"
                       aria-checked="${isSel ? 'true' : 'false'}"
                       aria-label="${escapeAttr(`Swatch ${hex}`)}"
                       data-hex="${escapeAttr(hex)}"
                       style="background:${escapeAttr(hex)}"
                       tabindex="${isSel ? '0' : '-1'}"></button>`;
    }
    row.innerHTML = html;
  }

  // -- Mutators -------------------------------------------------------

  /** Apply a hex string. Returns true on success. */
  private _setFromHex(input: string, emit: boolean): boolean {
    const rgb = hexToRgb(input);
    if (!rgb) return false;
    this._hsv = rgbToHsv(rgb);
    if (HEX8_RE.test(input)) {
      this._alphaVal = hexAlpha(input);
    }
    this._renderUi();
    this._commit(emit);
    return true;
  }

  private _currentHex(): string {
    const rgb = hsvToRgb(this._hsv);
    if (this.alpha && this._alphaVal < 1) {
      return `${rgbToHex(rgb)}${pad2(this._alphaVal * 255)}`;
    }
    return rgbToHex(rgb);
  }

  // -- Commit / events ------------------------------------------------

  private _commit(emit: boolean, intermediate = false): void {
    const hex = this._currentHex();
    // Form value: always canonical hex (with optional alpha).
    this._internals.setFormValue(hex);

    if (this.required && !hex) {
      this._internals.setValidity({ valueMissing: true }, 'Required');
    } else {
      this._internals.setValidity({});
    }

    // Reflect attribute (without retriggering rebuild).
    if (this.getAttribute('value')?.toLowerCase() !== hex.toLowerCase()) {
      this.setAttribute('value', hex);
    }

    if (!emit) return;

    const detail: AtlasColorPickerChangeDetail = {
      value: this._formattedValue(hex),
      hex,
    };

    this.dispatchEvent(
      new CustomEvent<AtlasColorPickerChangeDetail>('input', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );

    if (intermediate) return;

    this.dispatchEvent(
      new CustomEvent<AtlasColorPickerChangeDetail>('change', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
    const name = this.getAttribute('name');
    if (name && this.surfaceId) {
      this.emit(`${this.surfaceId}.${name}-changed`, { value: detail.value });
    }
  }

  private _formattedValue(hex: string): string {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const fmt = (this.getAttribute('format') ?? 'hex').toLowerCase();
    const includeAlpha = this.alpha && this._alphaVal < 1;
    switch (fmt) {
      case 'rgb':  return formatRgb(rgb, this._alphaVal, includeAlpha);
      case 'hsl':  return formatHsl(rgb, this._alphaVal, includeAlpha);
      case 'hex':
      default:     return hex.toUpperCase();
    }
  }
}

AtlasElement.define('atlas-color-picker', AtlasColorPicker);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-color-picker': AtlasColorPicker;
  }
}
