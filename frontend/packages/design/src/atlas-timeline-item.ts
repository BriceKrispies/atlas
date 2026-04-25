import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-timeline-item> — one row in an `<atlas-timeline>`.
 *
 * Slots:
 *   icon    — optional leading icon (rendered inside the dot).
 *   default — primary content (heading + body).
 *   meta    — optional trailing metadata (actor, status, link).
 *
 * Attributes:
 *   timestamp — ISO 8601 timestamp; rendered as relative "time ago".
 *   variant   — default | success | warning | danger | info — colours
 *               the dot.
 *
 * a11y: role="listitem". The timestamp is wrapped in a `<time>` element
 * with `datetime={iso}` so AT can read the absolute date if needed.
 */

const sheet = createSheet(`
  :host {
    display: grid;
    grid-template-columns: 28px 1fr;
    gap: var(--atlas-space-md);
    padding: 0 0 var(--atlas-space-lg) 0;
    position: relative;
  }
  /* Vertical rail rendered as a positioned pseudo element on the host
     so the line cannot fragment across long content. The last item
     trims its rail. */
  :host::before {
    content: "";
    position: absolute;
    left: 13px; /* (28px - 2px) / 2 */
    top: 18px;
    bottom: -8px;
    width: 2px;
    background: var(--atlas-color-border);
  }
  :host(:last-of-type)::before { display: none; }

  .dot {
    grid-column: 1;
    grid-row: 1 / span 2;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    background: var(--atlas-color-bg);
    border: 2px solid var(--atlas-color-border);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--atlas-color-text-muted);
    font-size: var(--atlas-font-size-xs);
    box-sizing: border-box;
    z-index: 1;
  }
  :host([variant="success"]) .dot { border-color: var(--atlas-color-success); color: var(--atlas-color-success); }
  :host([variant="warning"]) .dot { border-color: var(--atlas-color-warning); color: var(--atlas-color-warning); }
  :host([variant="danger"])  .dot { border-color: var(--atlas-color-danger);  color: var(--atlas-color-danger); }
  :host([variant="info"])    .dot { border-color: var(--atlas-color-primary); color: var(--atlas-color-primary); }

  .body {
    grid-column: 2;
    min-width: 0;
  }
  .header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--atlas-space-xs) var(--atlas-space-sm);
    margin-bottom: 4px;
  }
  .timestamp {
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-xs);
    color: var(--atlas-color-text-muted);
    white-space: nowrap;
  }
  .meta {
    display: block;
    margin-top: var(--atlas-space-xs);
    font-size: var(--atlas-font-size-xs);
    color: var(--atlas-color-text-muted);
  }
  .content {
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-sm);
    color: var(--atlas-color-text);
    line-height: var(--atlas-line-height);
  }
`);

export class AtlasTimelineItem extends AtlasElement {
  declare timestamp: string;
  declare variant: string;

  static {
    Object.defineProperty(this.prototype, 'timestamp', AtlasElement.strAttr('timestamp', ''));
    Object.defineProperty(this.prototype, 'variant', AtlasElement.strAttr('variant', ''));
  }

  static override get observedAttributes(): readonly string[] {
    return ['timestamp'];
  }

  private _built = false;
  private _timestampEl: HTMLElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'listitem');
    if (!this._built) this._build();
    this._syncTimestamp();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'timestamp') this._syncTimestamp();
  }

  private _build(): void {
    const root = this.shadowRoot;
    if (!root) return;
    root.innerHTML = `
      <div class="dot" aria-hidden="true"><slot name="icon"></slot></div>
      <div class="body">
        <div class="header">
          <time class="timestamp" data-part="timestamp" datetime=""></time>
        </div>
        <div class="content"><slot></slot></div>
        <div class="meta"><slot name="meta"></slot></div>
      </div>
    `;
    this._timestampEl = root.querySelector('.timestamp');
    this._built = true;
  }

  private _syncTimestamp(): void {
    const el = this._timestampEl;
    if (!el) return;
    const iso = this.getAttribute('timestamp') ?? '';
    if (!iso) {
      el.textContent = '';
      el.removeAttribute('datetime');
      return;
    }
    el.setAttribute('datetime', iso);
    el.setAttribute('title', iso);
    el.textContent = formatRelative(iso);
  }
}

/**
 * Tiny relative-time formatter. Uses `Intl.RelativeTimeFormat` when the
 * runtime exposes it (modern browsers + jsdom 21+); otherwise falls
 * back to a hand-rolled past/future formatter that mirrors its
 * vocabulary.
 *
 * Pure function. No timers. Callers needing live "tick" updates should
 * call `setAttribute('timestamp', iso)` again to re-render.
 */
function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const now = Date.now();
  const deltaSec = Math.round((t - now) / 1000); // negative = past
  const abs = Math.abs(deltaSec);

  if (abs < 30) return 'just now';

  const RTF = (globalThis as { Intl?: { RelativeTimeFormat?: new (...a: unknown[]) => Intl.RelativeTimeFormat } }).Intl?.RelativeTimeFormat;
  if (typeof RTF === 'function') {
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    if (abs < 60) return rtf.format(deltaSec, 'second');
    if (abs < 3600) return rtf.format(Math.round(deltaSec / 60), 'minute');
    if (abs < 86_400) return rtf.format(Math.round(deltaSec / 3600), 'hour');
    if (abs < 86_400 * 30) return rtf.format(Math.round(deltaSec / 86_400), 'day');
    return iso.slice(0, 10);
  }

  // Hand-rolled fallback.
  const future = deltaSec > 0;
  if (abs < 60) return tense(abs, 'second', future);
  const minutes = Math.round(abs / 60);
  if (minutes < 60) return tense(minutes, 'minute', future);
  const hours = Math.round(abs / 3600);
  if (hours < 24) return tense(hours, 'hour', future);
  const days = Math.round(abs / 86_400);
  if (days < 30) return tense(days, 'day', future);
  return iso.slice(0, 10);
}

function tense(n: number, unit: string, future: boolean): string {
  const plural = n === 1 ? unit : `${unit}s`;
  return future ? `in ${n} ${plural}` : `${n} ${plural} ago`;
}

AtlasElement.define('atlas-timeline-item', AtlasTimelineItem);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-timeline-item': AtlasTimelineItem;
  }
}
