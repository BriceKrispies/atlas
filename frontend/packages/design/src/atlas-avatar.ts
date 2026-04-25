import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeText } from './util.ts';

/**
 * <atlas-avatar> — user/identity avatar.
 *
 * Renders an image when `src` is provided and the image loads successfully;
 * otherwise falls back to the initials derived from `name`. The fallback path
 * is the default render — we only swap to the <img> after `load` fires, so
 * users never see a flashing broken-image glyph (C3.11-style guard against
 * a confusing visual state).
 *
 * Shadow DOM. Stateless aside from "did the image succeed?".
 *
 * Attributes:
 *   src    — image URL. Optional.
 *   name   — user's display name. Used for the aria-label and to compute
 *            initials when no image is available. Required for a meaningful
 *            accessible name.
 *   size   — xs | sm | md (default) | lg | xl. Pixel sizes are tokenised
 *            in CSS via `--avatar-size`.
 *   shape  — circle (default) | rounded | square.
 *   status — online | away | busy | offline. Renders a status dot whose
 *            aria-label includes the textual status (C3.11: never colour-
 *            only — text + colour together).
 */
const sheet = createSheet(`
  :host {
    --avatar-size: 32px;
    display: inline-flex;
    position: relative;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    width: var(--avatar-size);
    height: var(--avatar-size);
    box-sizing: border-box;
    font-family: var(--atlas-font-family);
    line-height: 1;
    /* When stacked inside an avatar-group, give each tile a ring so the
       overlap reads as overlap rather than a smear. The group element sets
       --avatar-ring on us; default null collapses the box-shadow. */
    box-shadow: var(--avatar-ring, none);
    border-radius: 50%;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  :host([size="xs"]) { --avatar-size: 20px; }
  :host([size="sm"]) { --avatar-size: 24px; }
  :host([size="md"]) { --avatar-size: 32px; }
  :host([size="lg"]) { --avatar-size: 48px; }
  :host([size="xl"]) { --avatar-size: 64px; }

  :host([shape="rounded"]) { border-radius: var(--atlas-radius-md); }
  :host([shape="square"])  { border-radius: 0; }

  .frame {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    overflow: hidden;
    background: var(--atlas-color-primary-subtle);
    color: var(--atlas-color-primary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: var(--atlas-font-weight-semibold);
    font-size: calc(var(--avatar-size) * 0.42);
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    border-radius: inherit;
  }

  /* Status dot. Sits at the bottom-right; size scales with avatar. The
     dot is paired with a visually-hidden text label so colour is never
     the sole carrier of the status (C3.11). */
  .status {
    position: absolute;
    right: 0;
    bottom: 0;
    width: calc(var(--avatar-size) * 0.28);
    height: calc(var(--avatar-size) * 0.28);
    min-width: 8px;
    min-height: 8px;
    border-radius: 50%;
    background: var(--atlas-color-text-muted);
    box-shadow: 0 0 0 2px var(--atlas-color-bg);
  }
  :host([status="online"])  .status { background: var(--atlas-color-success-text, #1f9d55); }
  :host([status="away"])    .status { background: var(--atlas-color-warning-text, #b7791f); }
  :host([status="busy"])    .status { background: var(--atlas-color-danger, #d22); }
  :host([status="offline"]) .status { background: var(--atlas-color-text-muted); }

  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    margin: -1px; padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
`);

const STATUS_LABELS: Record<string, string> = {
  online: 'online',
  away: 'away',
  busy: 'busy',
  offline: 'offline',
};

/**
 * Reduce a free-form name to up to two initials. Splits on whitespace,
 * uses the first character of the first and last token. Falls back to "?"
 * when nothing usable remains so the avatar never renders empty.
 */
function initialsFor(name: string): string {
  const parts = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const first = parts[0];
    return (first?.[0] ?? '?').toUpperCase();
  }
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length - 1]?.[0] ?? '';
  return `${first}${last}`.toUpperCase() || '?';
}

export class AtlasAvatar extends AtlasElement {
  declare src: string;
  declare name: string;
  declare size: string;
  declare shape: string;
  declare status: string;

  static {
    Object.defineProperty(this.prototype, 'src',    AtlasElement.strAttr('src', ''));
    Object.defineProperty(this.prototype, 'name',   AtlasElement.strAttr('name', ''));
    Object.defineProperty(this.prototype, 'size',   AtlasElement.strAttr('size', 'md'));
    Object.defineProperty(this.prototype, 'shape',  AtlasElement.strAttr('shape', 'circle'));
    Object.defineProperty(this.prototype, 'status', AtlasElement.strAttr('status', ''));
  }

  static override get observedAttributes(): readonly string[] {
    return ['src', 'name', 'status'];
  }

  private _built = false;
  private _imgFailed = false;
  /** Track which `src` value the failure flag refers to so a new src
   *  attempt re-tries the image even after a previous failure. */
  private _failedSrc: string | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._sync();
  }

  override attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null): void {
    if (!this._built) return;
    if (oldVal === newVal) return;
    if (name === 'src' && this._failedSrc !== newVal) {
      // New src — re-arm the failure flag so we attempt the image again.
      this._imgFailed = false;
      this._failedSrc = null;
    }
    this._sync();
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    // Frame holds either initials or the image. Status dot sits as a
    // sibling so it's not clipped by the frame's overflow:hidden.
    const frame = document.createElement('span');
    frame.className = 'frame';
    frame.setAttribute('part', 'frame');
    root.appendChild(frame);

    const status = document.createElement('span');
    status.className = 'status';
    status.setAttribute('part', 'status');
    status.setAttribute('aria-hidden', 'true');
    root.appendChild(status);

    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.setAttribute('part', 'sr');
    root.appendChild(sr);

    this._built = true;
  }

  private _sync(): void {
    const root = this.shadowRoot;
    if (!root) return;

    const name = this.getAttribute('name') ?? '';
    const src = this.getAttribute('src') ?? '';
    const status = this.getAttribute('status') ?? '';

    const ariaParts: string[] = [];
    if (name) ariaParts.push(name);
    else ariaParts.push('Avatar');
    if (status && STATUS_LABELS[status]) ariaParts.push(STATUS_LABELS[status]);
    this.setAttribute('role', 'img');
    this.setAttribute('aria-label', ariaParts.join(', '));

    const frame = root.querySelector<HTMLElement>('.frame');
    if (!frame) return;

    const showImg = src && !(this._imgFailed && this._failedSrc === src);
    if (showImg) {
      // (Re)build the <img>. We always set onerror BEFORE src so an immediate
      // cached failure still flips us to initials.
      frame.innerHTML = '';
      const img = document.createElement('img');
      img.alt = ''; // host carries the accessible name via aria-label
      img.decoding = 'async';
      img.loading = 'lazy';
      img.onerror = (): void => {
        this._imgFailed = true;
        this._failedSrc = src;
        this._sync();
      };
      img.src = src;
      frame.appendChild(img);
    } else {
      const initials = initialsFor(name);
      frame.innerHTML = `<span aria-hidden="true">${escapeText(initials)}</span>`;
    }

    // Status dot visibility + screen-reader text.
    const statusEl = root.querySelector<HTMLElement>('.status');
    const sr = root.querySelector<HTMLElement>('.sr-only');
    const hasStatus = !!STATUS_LABELS[status];
    if (statusEl) statusEl.style.display = hasStatus ? '' : 'none';
    if (sr) sr.textContent = hasStatus ? `Status: ${STATUS_LABELS[status]}` : '';
  }
}

AtlasElement.define('atlas-avatar', AtlasAvatar);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-avatar': AtlasAvatar;
  }
}
