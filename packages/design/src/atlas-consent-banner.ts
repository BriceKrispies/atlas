import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, uid } from './util.ts';

/**
 * <atlas-consent-banner> — agent permission gate.
 *
 * "The agent is about to do X. Approve / Deny." Designed for the
 * agent-editable surfaces where the platform must obtain explicit
 * user consent before performing a privileged action.
 *
 * Fail-safe defaults:
 *   - Default focus lands on the Deny button.
 *   - Pressing Enter does NOT submit Approve. The Approve button
 *     is a `type="button"` and never the default form action; both
 *     buttons require an explicit click or Space activation.
 *   - When `severity="danger"`, the host uses `role="alertdialog"` so
 *     assistive technology announces it as a blocking decision.
 *
 * Attributes:
 *   title          — short heading.
 *   severity       — info (default) | warning | danger
 *   approve-label  — button text (default "Approve")
 *   deny-label     — button text (default "Deny")
 *   sticky         — (boolean) anchors to the top of the nearest
 *                    positioned ancestor (e.g., a scroll container).
 *
 * Slots:
 *   default — description text.
 *   details — optional `<details>` body — additional context/justification.
 *
 * Events:
 *   approve — user clicked Approve.
 *   deny    — user clicked Deny.
 *
 * Shadow DOM, encapsulated styles via adoptSheet().
 */
export type AtlasConsentSeverity = 'info' | 'warning' | 'danger';

const sheet = createSheet(`
  :host {
    display: block;
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    overflow: hidden;
  }
  :host([severity="info"]) {
    border-color: #93c5fd;
    background: var(--atlas-color-primary-subtle, #eff4ff);
  }
  :host([severity="warning"]) {
    border-color: #f59e0b;
    background: var(--atlas-color-warning-subtle, #fffbeb);
  }
  :host([severity="danger"]) {
    border-color: var(--atlas-color-danger);
    background: var(--atlas-color-danger-subtle, #fef2f2);
  }
  :host([sticky]) {
    position: sticky;
    top: 0;
    z-index: 5;
    box-shadow: var(--atlas-shadow-md, 0 1px 3px rgba(0,0,0,0.06));
  }
  .row {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--atlas-space-sm);
    align-items: start;
    padding: var(--atlas-space-md);
  }
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
  }
  .icon svg { width: 22px; height: 22px; display: block; }
  :host([severity="info"]) .icon { color: #1d4ed8; }
  :host([severity="warning"]) .icon { color: var(--atlas-color-warning, #d97706); }
  :host([severity="danger"]) .icon { color: var(--atlas-color-danger); }

  .body { min-width: 0; }
  .title {
    font-family: var(--atlas-font-family);
    font-weight: var(--atlas-font-weight-medium, 500);
    font-size: var(--atlas-font-size-md);
    margin: 0 0 var(--atlas-space-xs) 0;
    color: var(--atlas-color-text);
  }
  .description {
    font-family: var(--atlas-font-family);
    color: var(--atlas-color-text);
    margin: 0;
  }
  .details-wrap {
    margin-top: var(--atlas-space-sm);
    padding: var(--atlas-space-sm);
    border: 1px dashed var(--atlas-color-border);
    border-radius: var(--atlas-radius-sm);
    background: var(--atlas-color-bg);
  }
  .details-wrap:not(.has-content) { display: none; }

  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--atlas-space-sm);
    padding: 0 var(--atlas-space-md) var(--atlas-space-md);
  }
  @media (min-width: 640px) {
    .actions {
      flex-direction: row;
      justify-content: flex-end;
    }
  }
  button {
    min-height: var(--atlas-touch-target-min, 44px);
    min-width: var(--atlas-touch-target-min, 44px);
    padding: 0 var(--atlas-space-md);
    border-radius: var(--atlas-radius-md);
    font: inherit;
    font-family: var(--atlas-font-family);
    font-weight: var(--atlas-font-weight-medium, 500);
    cursor: pointer;
    border: 1px solid var(--atlas-color-border);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
  }
  button.deny {
    border-color: var(--atlas-color-border-strong);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
  }
  button.deny:hover { background: var(--atlas-color-surface-hover, #f3f4f6); }
  button.approve {
    background: var(--atlas-color-primary, #2563eb);
    border-color: var(--atlas-color-primary, #2563eb);
    color: #fff;
  }
  :host([severity="danger"]) button.approve {
    background: var(--atlas-color-danger);
    border-color: var(--atlas-color-danger);
  }
  button:focus-visible {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 2px;
  }
`);

const ICON_INFO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/></svg>';
const ICON_WARN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/></svg>';
const ICON_DANGER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>';

export class AtlasConsentBanner extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['title', 'severity', 'approve-label', 'deny-label', 'sticky'];
  }

  declare sticky: boolean;
  static {
    Object.defineProperty(this.prototype, 'sticky', AtlasElement.boolAttr('sticky'));
  }

  private readonly _titleId = uid('atlas-cb-title');
  private readonly _descId = uid('atlas-cb-desc');
  private _built = false;
  private _iconEl: HTMLElement | null = null;
  private _titleEl: HTMLElement | null = null;
  private _approveBtn: HTMLButtonElement | null = null;
  private _denyBtn: HTMLButtonElement | null = null;
  private _detailsWrap: HTMLElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this._syncSeverityRole();
    this._syncTitle();
    this._syncLabels();
    // Defer focus so this works even when render order matters (e.g.
    // banner appended right before the composer focuses something else).
    queueMicrotask(() => this._denyBtn?.focus());
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'severity') this._syncSeverityRole();
    else if (name === 'title') this._syncTitle();
    else if (name === 'approve-label' || name === 'deny-label') this._syncLabels();
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;

    const row = document.createElement('div');
    row.className = 'row';

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.setAttribute('aria-hidden', 'true');
    row.appendChild(icon);

    const body = document.createElement('div');
    body.className = 'body';

    const title = document.createElement('h2');
    title.className = 'title';
    title.id = this._titleId;
    body.appendChild(title);

    const desc = document.createElement('div');
    desc.className = 'description';
    desc.id = this._descId;
    const defaultSlot = document.createElement('slot');
    desc.appendChild(defaultSlot);
    body.appendChild(desc);

    const detailsWrap = document.createElement('div');
    detailsWrap.className = 'details-wrap';
    const detailsSlot = document.createElement('slot');
    detailsSlot.setAttribute('name', 'details');
    detailsWrap.appendChild(detailsSlot);
    detailsSlot.addEventListener('slotchange', () => {
      const has = detailsSlot.assignedNodes({ flatten: true }).length > 0;
      detailsWrap.classList.toggle('has-content', has);
    });
    body.appendChild(detailsWrap);
    row.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const denyBtn = document.createElement('button');
    denyBtn.type = 'button';
    denyBtn.className = 'deny';
    denyBtn.textContent = 'Deny';
    denyBtn.addEventListener('click', () => this._onDeny());

    const approveBtn = document.createElement('button');
    approveBtn.type = 'button';
    approveBtn.className = 'approve';
    approveBtn.textContent = 'Approve';
    approveBtn.addEventListener('click', () => this._onApprove());

    actions.appendChild(denyBtn);
    actions.appendChild(approveBtn);

    root.appendChild(row);
    root.appendChild(actions);

    this.setAttribute('aria-labelledby', this._titleId);
    this.setAttribute('aria-describedby', this._descId);

    this._iconEl = icon;
    this._titleEl = title;
    this._approveBtn = approveBtn;
    this._denyBtn = denyBtn;
    this._detailsWrap = detailsWrap;
    this._built = true;
  }

  private _syncSeverityRole(): void {
    const sev = this._currentSeverity();
    this.setAttribute('role', sev === 'danger' ? 'alertdialog' : 'region');
    if (this._iconEl) {
      let icon = ICON_INFO;
      if (sev === 'warning') icon = ICON_WARN;
      else if (sev === 'danger') icon = ICON_DANGER;
      this._iconEl.innerHTML = icon;
    }
  }

  private _syncTitle(): void {
    if (!this._titleEl) return;
    this._titleEl.textContent = this.getAttribute('title') ?? '';
  }

  private _syncLabels(): void {
    if (this._approveBtn) {
      this._approveBtn.textContent = this.getAttribute('approve-label') ?? 'Approve';
    }
    if (this._denyBtn) {
      this._denyBtn.textContent = this.getAttribute('deny-label') ?? 'Deny';
    }
    void this._detailsWrap;
  }

  private _currentSeverity(): AtlasConsentSeverity {
    const raw = this.getAttribute('severity');
    if (raw === 'warning' || raw === 'danger' || raw === 'info') return raw;
    return 'info';
  }

  private _onApprove(): void {
    this.dispatchEvent(new CustomEvent('approve', { bubbles: true, composed: true }));
  }

  private _onDeny(): void {
    this.dispatchEvent(new CustomEvent('deny', { bubbles: true, composed: true }));
  }
}

AtlasElement.define('atlas-consent-banner', AtlasConsentBanner);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-consent-banner': AtlasConsentBanner;
  }
}
