import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeText } from './util.ts';

/**
 * <atlas-activity> — agent run / tool-call status card.
 *
 * Compact header with a status icon, title, and elapsed-time readout.
 * The body slot accepts streaming log lines (consumer passes
 * `<atlas-text>`, `<atlas-code>`, or nested `<atlas-activity>` elements).
 *
 * The elapsed timer ticks via a single `requestAnimationFrame` loop that
 * runs ONLY while `status === 'running'`. The loop tears itself down when
 * the status changes — no `setInterval` is used (C14.2-aligned).
 *
 * Attributes:
 *   status      — pending | running | success | error | canceled
 *   title       — short label rendered in the header.
 *   started-at  — ISO-8601 timestamp when the run began.
 *   ended-at    — ISO-8601 timestamp when the run ended (optional).
 *   cancelable  — (boolean) renders a Cancel button in the header.
 *
 * Events:
 *   cancel      — user clicked the Cancel button (only fires while
 *                 status === 'running' and `cancelable` is set).
 *
 * Shadow DOM, encapsulated styles via adoptSheet().
 */
export type AtlasActivityStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'canceled';

const sheet = createSheet(`
  :host {
    display: block;
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-sm);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    background: var(--atlas-color-surface);
    border-bottom: 1px solid var(--atlas-color-border);
    min-height: var(--atlas-touch-target-min, 44px);
  }
  .indicator {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    flex: 0 0 auto;
    color: var(--atlas-color-text-muted);
  }
  :host([status="success"]) .indicator { color: var(--atlas-color-success-text, #15603a); }
  :host([status="error"])   .indicator { color: var(--atlas-color-danger); }
  :host([status="canceled"]) .indicator { color: var(--atlas-color-text-muted); }
  :host([status="running"]) .indicator { color: var(--atlas-color-primary, #2563eb); }
  .indicator svg { width: 18px; height: 18px; display: block; }
  .indicator .spin { animation: atlas-activity-spin 1s linear infinite; }
  @keyframes atlas-activity-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .indicator .spin { animation: none; }
  }
  .title {
    font-family: var(--atlas-font-family);
    font-weight: var(--atlas-font-weight-medium, 500);
    color: var(--atlas-color-text);
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .elapsed {
    font-family: var(--atlas-font-family-mono, ui-monospace, monospace);
    font-size: var(--atlas-font-size-sm);
    color: var(--atlas-color-text-muted);
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }
  .cancel {
    flex: 0 0 auto;
    min-width: var(--atlas-touch-target-min, 44px);
    min-height: var(--atlas-touch-target-min, 44px);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: transparent;
    color: var(--atlas-color-text);
    font: inherit;
    cursor: pointer;
    padding: 0 var(--atlas-space-sm);
  }
  .cancel:hover { background: var(--atlas-color-surface-hover, #f3f4f6); }
  .cancel:focus-visible { outline: 2px solid var(--atlas-color-primary); outline-offset: 1px; }
  .body {
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    font-family: var(--atlas-font-family-mono, ui-monospace, monospace);
    font-size: var(--atlas-font-size-sm);
    max-height: 40vh;
    overflow: auto;
  }
  .body:empty { display: none; }
  ::slotted(*) {
    display: block;
    margin: 0 0 4px 0;
  }
`);

const ICON_RUNNING =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false" class="spin"><circle cx="12" cy="12" r="9" opacity="0.2"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>';
const ICON_SUCCESS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12l5 5 9-11"/></svg>';
const ICON_ERROR =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_PENDING =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" opacity="0.4"/></svg>';
const ICON_CANCELED =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>';

export class AtlasActivity extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['status', 'title', 'started-at', 'ended-at', 'cancelable'];
  }

  declare cancelable: boolean;
  static {
    Object.defineProperty(this.prototype, 'cancelable', AtlasElement.boolAttr('cancelable'));
  }

  private _built = false;
  private _indicator: HTMLElement | null = null;
  private _titleEl: HTMLElement | null = null;
  private _elapsedEl: HTMLElement | null = null;
  private _cancelBtn: HTMLButtonElement | null = null;
  private _rafHandle: number | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this.setAttribute('role', 'group');
    this._syncAll();
    this._maybeStartTicker();
  }

  override disconnectedCallback(): void {
    this._stopTicker();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'status') {
      this._syncStatus();
      this._maybeStartTicker();
    } else if (name === 'title') {
      this._syncTitle();
    } else if (name === 'started-at' || name === 'ended-at') {
      this._syncElapsed();
    } else if (name === 'cancelable') {
      this._syncCancel();
    }
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;

    const header = document.createElement('div');
    header.className = 'header';

    const indicator = document.createElement('span');
    indicator.className = 'indicator';
    indicator.setAttribute('aria-hidden', 'true');
    header.appendChild(indicator);

    const titleEl = document.createElement('span');
    titleEl.className = 'title';
    header.appendChild(titleEl);

    const elapsedEl = document.createElement('span');
    elapsedEl.className = 'elapsed';
    elapsedEl.setAttribute('aria-live', 'off');
    header.appendChild(elapsedEl);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.display = 'none';
    cancelBtn.addEventListener('click', () => this._onCancel());
    header.appendChild(cancelBtn);

    const body = document.createElement('div');
    body.className = 'body';
    const slot = document.createElement('slot');
    body.appendChild(slot);

    root.appendChild(header);
    root.appendChild(body);

    this._indicator = indicator;
    this._titleEl = titleEl;
    this._elapsedEl = elapsedEl;
    this._cancelBtn = cancelBtn;
    this._built = true;
  }

  private _syncAll(): void {
    this._syncStatus();
    this._syncTitle();
    this._syncElapsed();
    this._syncCancel();
  }

  private _syncStatus(): void {
    if (!this._indicator) return;
    const status = this._currentStatus();
    let icon = ICON_PENDING;
    let label = 'Pending';
    if (status === 'running') { icon = ICON_RUNNING; label = 'Running'; }
    else if (status === 'success') { icon = ICON_SUCCESS; label = 'Succeeded'; }
    else if (status === 'error') { icon = ICON_ERROR; label = 'Failed'; }
    else if (status === 'canceled') { icon = ICON_CANCELED; label = 'Canceled'; }
    this._indicator.innerHTML = icon;
    this._indicator.setAttribute('aria-label', label);
  }

  private _syncTitle(): void {
    if (!this._titleEl) return;
    this._titleEl.textContent = this.getAttribute('title') ?? '';
  }

  private _syncCancel(): void {
    if (!this._cancelBtn) return;
    const canCancel = this.cancelable && this._currentStatus() === 'running';
    this._cancelBtn.style.display = canCancel ? '' : 'none';
  }

  private _currentStatus(): AtlasActivityStatus {
    const raw = this.getAttribute('status');
    if (raw === 'running' || raw === 'success' || raw === 'error' || raw === 'canceled' || raw === 'pending') {
      return raw;
    }
    return 'pending';
  }

  private _onCancel(): void {
    if (this._currentStatus() !== 'running') return;
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }));
  }

  private _maybeStartTicker(): void {
    const status = this._currentStatus();
    if (status === 'running') {
      this._startTicker();
    } else {
      this._stopTicker();
      this._syncElapsed();
      this._syncCancel();
    }
  }

  private _startTicker(): void {
    if (this._rafHandle != null) return;
    const tick = (): void => {
      if (this._currentStatus() !== 'running') {
        this._rafHandle = null;
        return;
      }
      this._syncElapsed();
      this._rafHandle = requestAnimationFrame(tick);
    };
    this._rafHandle = requestAnimationFrame(tick);
  }

  private _stopTicker(): void {
    if (this._rafHandle != null) {
      cancelAnimationFrame(this._rafHandle);
      this._rafHandle = null;
    }
  }

  private _syncElapsed(): void {
    if (!this._elapsedEl) return;
    const startedAt = this.getAttribute('started-at');
    if (!startedAt) {
      this._elapsedEl.textContent = '';
      return;
    }
    const startMs = Date.parse(startedAt);
    if (Number.isNaN(startMs)) {
      this._elapsedEl.textContent = '';
      return;
    }
    const status = this._currentStatus();
    let endMs: number;
    if (status === 'running' || status === 'pending') {
      endMs = Date.now();
    } else {
      const ended = this.getAttribute('ended-at');
      endMs = ended ? Date.parse(ended) : Date.now();
      if (Number.isNaN(endMs)) endMs = Date.now();
    }
    const ms = Math.max(0, endMs - startMs);
    this._elapsedEl.textContent = formatElapsed(ms);
  }
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.floor(ms / 1000);
  const tenths = Math.floor((ms % 1000) / 100);
  if (totalSec < 60) return `${totalSec}.${tenths}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${String(mm).padStart(2, '0')}m`;
}

// Used to silence unused-import lint where escapeText might be useful in the future.
void escapeText;

AtlasElement.define('atlas-activity', AtlasActivity);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-activity': AtlasActivity;
  }
}
