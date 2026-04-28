import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-tree-item> — node inside an `<atlas-tree>`.
 *
 * Composition: nested `<atlas-tree-item>` children become the node's
 * sub-tree. The first text node OR the `label` attribute is the
 * displayed label; everything else is the children list.
 *
 * Attributes:
 *   value     — required; identifier emitted on select/expand events.
 *   label     — optional; if absent the first text child is used.
 *   expanded  — boolean; whether children are visible.
 *   selected  — boolean; whether this node is in the selection.
 *   disabled  — boolean; non-interactive.
 *
 * The element exposes `role="treeitem"` plus `aria-level`, `aria-expanded`,
 * `aria-selected` and a roving `tabindex`. The PARENT tree owns roving
 * focus + selection mode + keyboard routing — this element only renders
 * and exposes its surgical-update API (`setExpanded`, `setSelected`,
 * `setTabbable`, `setLevel`).
 */

const sheet = createSheet(`
  :host {
    display: block;
    --atlas-tree-indent: var(--atlas-space-md);
  }
  :host([hidden-by-collapse]) { display: none; }

  .row {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-xs);
    min-height: var(--atlas-touch-target-min, 44px);
    padding-inline: var(--atlas-space-xs);
    padding-inline-start: calc(var(--atlas-tree-indent) * (var(--atlas-tree-level, 1) - 1));
    border-radius: var(--atlas-radius-sm);
    cursor: pointer;
    color: var(--atlas-color-text);
    -webkit-tap-highlight-color: transparent;
    user-select: none;
    transition: background var(--atlas-transition-fast);
  }
  .row:hover { background: var(--atlas-color-surface); }
  :host([selected]) .row {
    background: var(--atlas-color-primary-subtle);
    color: var(--atlas-color-primary);
  }
  :host([disabled]) .row {
    opacity: 0.5;
    cursor: not-allowed;
  }
  :host(:focus) { outline: none; }
  :host(:focus-visible) .row {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: 0;
  }
  .twisty {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--atlas-color-text-muted);
    transition: transform var(--atlas-transition-fast);
  }
  :host([expanded]) .twisty { transform: rotate(90deg); }
  .twisty[hidden] { visibility: hidden; }
  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--atlas-font-size-sm);
  }
  .group { display: block; }
  .group[hidden] { display: none; }

  @media (prefers-reduced-motion: reduce) {
    .twisty { transition: none; }
  }
`);

export class AtlasTreeItem extends AtlasElement {
  declare value: string;
  declare label: string;
  declare expanded: boolean;
  declare selected: boolean;
  declare disabled: boolean;

  static {
    Object.defineProperty(this.prototype, 'value', AtlasElement.strAttr('value', ''));
    Object.defineProperty(this.prototype, 'label', AtlasElement.strAttr('label', ''));
    Object.defineProperty(this.prototype, 'expanded', AtlasElement.boolAttr('expanded'));
    Object.defineProperty(this.prototype, 'selected', AtlasElement.boolAttr('selected'));
    Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
  }

  static override get observedAttributes(): readonly string[] {
    return ['expanded', 'selected', 'disabled', 'label'];
  }

  private _built = false;
  private _row: HTMLElement | null = null;
  private _twisty: HTMLElement | null = null;
  private _labelEl: HTMLElement | null = null;
  private _group: HTMLElement | null = null;
  private _capturedLabel: string | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'treeitem');
    if (!this._built) this._buildShell();
    this._syncAll();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'expanded') this._syncExpanded();
    else if (name === 'selected') this._syncSelected();
    else if (name === 'disabled') this._syncDisabled();
    else if (name === 'label') this._syncLabel();
  }

  /** Surgical updates exposed for the parent tree. */
  setExpanded(value: boolean): void {
    if (value) this.setAttribute('expanded', '');
    else this.removeAttribute('expanded');
  }
  setSelected(value: boolean): void {
    if (value) this.setAttribute('selected', '');
    else this.removeAttribute('selected');
  }
  setTabbable(value: boolean): void {
    this.setAttribute('tabindex', value ? '0' : '-1');
  }
  setLevel(level: number): void {
    this.style.setProperty('--atlas-tree-level', String(level));
    this.setAttribute('aria-level', String(level));
  }
  hasChildren(): boolean {
    return !!this.querySelector(':scope > atlas-tree-item');
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    // Capture the textual label from the slotted children before we
    // start projecting them. We look for the first non-empty text node
    // that is a direct child; everything else (including nested
    // tree-items) is projected through the group slot.
    if (!this._capturedLabel) {
      for (const node of Array.from(this.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          const t = node.textContent?.trim() ?? '';
          if (t) {
            this._capturedLabel = t;
            // Remove the text node so it doesn't leak into the slot.
            node.parentNode?.removeChild(node);
            break;
          }
        }
      }
    }

    const row = document.createElement('div');
    row.className = 'row';
    row.dataset['part'] = 'row';
    const twisty = document.createElement('span');
    twisty.className = 'twisty';
    twisty.setAttribute('aria-hidden', 'true');
    twisty.innerHTML = `<svg viewBox="0 0 16 16" width="10" height="10" focusable="false" aria-hidden="true"><path d="M5 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const label = document.createElement('span');
    label.className = 'label';
    label.dataset['part'] = 'label';
    row.appendChild(twisty);
    row.appendChild(label);

    const group = document.createElement('div');
    group.className = 'group';
    group.setAttribute('role', 'group');
    const slot = document.createElement('slot');
    group.appendChild(slot);

    root.appendChild(row);
    root.appendChild(group);

    this._row = row;
    this._twisty = twisty;
    this._labelEl = label;
    this._group = group;
    this._built = true;
  }

  private _syncAll(): void {
    this._syncLabel();
    this._syncExpanded();
    this._syncSelected();
    this._syncDisabled();
  }

  private _syncLabel(): void {
    if (!this._labelEl) return;
    const explicit = this.getAttribute('label');
    const text = explicit || this._capturedLabel || this.getAttribute('value') || '';
    this._labelEl.textContent = text;
  }

  private _syncExpanded(): void {
    const expanded = this.hasAttribute('expanded');
    const hasKids = this.hasChildren();
    if (this._twisty) this._twisty.hidden = !hasKids;
    if (this._group) this._group.hidden = !expanded || !hasKids;
    if (hasKids) this.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    else this.removeAttribute('aria-expanded');
  }

  private _syncSelected(): void {
    if (this.hasAttribute('selected')) this.setAttribute('aria-selected', 'true');
    else this.setAttribute('aria-selected', 'false');
  }

  private _syncDisabled(): void {
    if (this.hasAttribute('disabled')) this.setAttribute('aria-disabled', 'true');
    else this.removeAttribute('aria-disabled');
  }
}

AtlasElement.define('atlas-tree-item', AtlasTreeItem);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-tree-item': AtlasTreeItem;
  }
}
