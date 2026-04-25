import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-json-view> — read-only, expandable JSON tree.
 *
 * Mobile-first, framework-free. Renders a tree of values where every
 * object/array branch is collapsible. Long string values truncate
 * with a "show more" affordance.
 *
 * Type signal is conveyed redundantly through colour AND a typed
 * prefix glyph (str/num/bool/null/{}/[]) so the cue is not colour-only
 * (C3.11).
 *
 * Data input:
 *   - Property `data` (JS object/array/primitive) is the canonical input.
 *   - Attribute `data-json` is a serialized JSON fallback for
 *     declarative usage (specimens, tests, agent emissions).
 *
 * Keyboard:
 *   - ArrowRight expands a collapsed node (or moves to first child).
 *   - ArrowLeft collapses or moves to parent.
 *   - ArrowDown / ArrowUp move between visible tree items.
 *   - Enter / Space toggles the focused node.
 *
 * Accessibility:
 *   - Host is `role="tree"`. Each row is `role="treeitem"` and exposes
 *     `aria-expanded` on collapsible nodes.
 *
 * Shadow DOM, encapsulated styles via adoptSheet().
 */

const STRING_TRUNCATE = 120;

const sheet = createSheet(`
  :host {
    display: block;
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    font-family: var(--atlas-font-family-mono, ui-monospace, SFMono-Regular, monospace);
    font-size: var(--atlas-font-size-sm);
    overflow: auto;
    max-height: 60vh;
    padding: var(--atlas-space-sm) 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li[role="treeitem"] {
    outline: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-xs);
    padding: 2px var(--atlas-space-sm);
    min-height: var(--atlas-touch-target-min, 44px);
    cursor: default;
  }
  .row.toggleable {
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  li[role="treeitem"]:focus-visible > .row {
    outline: 2px solid var(--atlas-color-primary);
    outline-offset: -2px;
    border-radius: var(--atlas-radius-sm);
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.25em;
    height: 1.25em;
    color: var(--atlas-color-text-muted);
    user-select: none;
    flex: 0 0 auto;
  }
  .toggle.placeholder { visibility: hidden; }
  .key {
    color: var(--atlas-color-text);
    font-weight: 600;
  }
  .colon { color: var(--atlas-color-text-muted); }
  .type-tag {
    font-size: 0.75em;
    text-transform: lowercase;
    color: var(--atlas-color-text-muted);
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-sm);
    padding: 0 4px;
    margin-right: 4px;
    flex: 0 0 auto;
  }
  .v-string  { color: var(--atlas-color-success-text, #15603a); }
  .v-number  { color: #1d4ed8; }
  .v-boolean { color: #b45309; font-weight: 600; }
  .v-null    { color: var(--atlas-color-text-muted); font-style: italic; }
  .v-summary { color: var(--atlas-color-text-muted); font-style: italic; }
  ul.children {
    margin-left: 1.25em;
    padding-left: var(--atlas-space-sm);
    border-left: 1px dashed var(--atlas-color-border);
  }
  .more {
    margin-left: var(--atlas-space-xs);
    background: transparent;
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-sm);
    padding: 0 6px;
    font: inherit;
    color: var(--atlas-color-text-muted);
    cursor: pointer;
    min-height: 28px;
  }
  .more:hover { background: var(--atlas-color-surface); }
  .more:focus-visible { outline: 2px solid var(--atlas-color-primary); outline-offset: 1px; }
  .empty {
    padding: var(--atlas-space-md);
    color: var(--atlas-color-text-muted);
    font-family: var(--atlas-font-family);
    text-align: center;
  }
`);

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

interface NodeState {
  expanded: boolean;
  expandedStrings: Set<string>; // path keys whose long strings have been expanded
}

export class AtlasJsonView extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['data-json'];
  }

  declare _data: JsonValue | undefined;
  private _state: NodeState = { expanded: true, expandedStrings: new Set() };
  private _expandedPaths = new Set<string>([':root']);
  private _root: ShadowRoot | null = null;
  private _list: HTMLUListElement | null = null;
  private _built = false;

  constructor() {
    super();
    this._root = this.attachShadow({ mode: 'open' });
    adoptSheet(this._root, sheet);
  }

  /** Set the JS-native data to render. Triggers a re-render. */
  set data(value: JsonValue | undefined) {
    this._data = value;
    this._render();
  }
  get data(): JsonValue | undefined {
    return this._data;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this.setAttribute('role', 'tree');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'JSON tree');
    if (this._data === undefined) this._loadFromAttr();
    this._render();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'data-json') {
      this._loadFromAttr();
      this._render();
    }
  }

  private _loadFromAttr(): void {
    const raw = this.getAttribute('data-json');
    if (raw == null || raw === '') {
      if (this._data === undefined) this._data = null;
      return;
    }
    try {
      this._data = JSON.parse(raw) as JsonValue;
    } catch {
      this._data = null;
    }
  }

  private _buildShell(): void {
    if (!this._root) return;
    const ul = document.createElement('ul');
    this._root.appendChild(ul);
    this._list = ul;
    ul.addEventListener('click', (ev) => this._onClick(ev));
    ul.addEventListener('keydown', (ev) => this._onKey(ev));
    this._built = true;
  }

  private _render(): void {
    if (!this._list) return;
    this._list.innerHTML = '';
    if (this._data === undefined) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'No data.';
      this._list.appendChild(empty);
      return;
    }
    this._renderNode(this._list, this._data, ':root', null, 0);
  }

  private _renderNode(
    parentList: HTMLUListElement,
    value: JsonValue,
    path: string,
    keyLabel: string | null,
    depth: number,
  ): void {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    li.setAttribute('aria-level', String(depth + 1));
    li.tabIndex = depth === 0 ? 0 : -1;
    li.dataset['path'] = path;

    const row = document.createElement('div');
    row.className = 'row';
    li.appendChild(row);

    const isObject = value !== null && typeof value === 'object';
    const isArray = Array.isArray(value);

    const toggle = document.createElement('span');
    toggle.className = 'toggle';
    if (isObject) {
      const expanded = this._expandedPaths.has(path);
      li.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      row.classList.add('toggleable');
      toggle.textContent = expanded ? '▾' : '▸';
    } else {
      toggle.classList.add('placeholder');
      toggle.textContent = '·';
    }
    row.appendChild(toggle);

    if (keyLabel !== null) {
      const k = document.createElement('span');
      k.className = 'key';
      k.textContent = keyLabel;
      row.appendChild(k);
      const colon = document.createElement('span');
      colon.className = 'colon';
      colon.textContent = ': ';
      row.appendChild(colon);
    }

    const tag = document.createElement('span');
    tag.className = 'type-tag';
    tag.setAttribute('aria-hidden', 'true');
    if (isArray) tag.textContent = '[]';
    else if (isObject) tag.textContent = '{}';
    else if (value === null) tag.textContent = 'null';
    else if (typeof value === 'string') tag.textContent = 'str';
    else if (typeof value === 'number') tag.textContent = 'num';
    else if (typeof value === 'boolean') tag.textContent = 'bool';
    row.appendChild(tag);

    if (isArray) {
      const arr = value;
      const summary = document.createElement('span');
      summary.className = 'v-summary';
      summary.textContent = `Array(${arr.length})`;
      row.appendChild(summary);
    } else if (isObject) {
      const obj = value;
      const keys = Object.keys(obj as Record<string, unknown>);
      const summary = document.createElement('span');
      summary.className = 'v-summary';
      summary.textContent = `Object{${keys.length}}`;
      row.appendChild(summary);
    } else if (typeof value === 'string') {
      this._renderString(row, value, path);
    } else if (typeof value === 'number') {
      const v = document.createElement('span');
      v.className = 'v-number';
      v.textContent = String(value);
      row.appendChild(v);
    } else if (typeof value === 'boolean') {
      const v = document.createElement('span');
      v.className = 'v-boolean';
      v.textContent = String(value);
      row.appendChild(v);
    } else if (value === null) {
      const v = document.createElement('span');
      v.className = 'v-null';
      v.textContent = 'null';
      row.appendChild(v);
    }

    parentList.appendChild(li);

    if (isObject && this._expandedPaths.has(path)) {
      const childUl = document.createElement('ul');
      childUl.className = 'children';
      li.appendChild(childUl);
      if (isArray) {
        const arr = value;
        for (let i = 0; i < arr.length; i++) {
          this._renderNode(childUl, arr[i] as JsonValue, `${path}.${i}`, String(i), depth + 1);
        }
      } else {
        const obj = value as Record<string, JsonValue>;
        for (const k of Object.keys(obj)) {
          const v = obj[k];
          if (v === undefined) continue;
          this._renderNode(childUl, v, `${path}.${k}`, k, depth + 1);
        }
      }
    }
  }

  private _renderString(row: HTMLElement, value: string, path: string): void {
    const v = document.createElement('span');
    v.className = 'v-string';
    const expanded = this._state.expandedStrings.has(path);
    if (value.length <= STRING_TRUNCATE || expanded) {
      v.textContent = JSON.stringify(value);
      row.appendChild(v);
      if (value.length > STRING_TRUNCATE) {
        const less = document.createElement('button');
        less.type = 'button';
        less.className = 'more';
        less.textContent = 'show less';
        less.dataset['action'] = 'string-toggle';
        less.dataset['path'] = path;
        row.appendChild(less);
      }
    } else {
      v.textContent = JSON.stringify(value.slice(0, STRING_TRUNCATE)) + '…';
      row.appendChild(v);
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'more';
      more.textContent = `show more (${value.length - STRING_TRUNCATE} chars)`;
      more.dataset['action'] = 'string-toggle';
      more.dataset['path'] = path;
      row.appendChild(more);
    }
  }

  private _onClick(ev: Event): void {
    const target = ev.target as Element | null;
    if (!target) return;
    const moreBtn = target.closest('button.more') as HTMLButtonElement | null;
    if (moreBtn && moreBtn.dataset['action'] === 'string-toggle') {
      const path = moreBtn.dataset['path'] ?? '';
      if (this._state.expandedStrings.has(path)) this._state.expandedStrings.delete(path);
      else this._state.expandedStrings.add(path);
      this._render();
      return;
    }
    const row = target.closest('.row.toggleable') as HTMLElement | null;
    if (!row) return;
    const li = row.parentElement as HTMLLIElement | null;
    if (!li) return;
    const path = li.dataset['path'] ?? '';
    this._togglePath(path);
    li.focus();
  }

  private _onKey(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement | null;
    if (!target || target.getAttribute('role') !== 'treeitem') return;
    const path = target.dataset['path'] ?? '';
    const expandable = target.hasAttribute('aria-expanded');
    const expanded = target.getAttribute('aria-expanded') === 'true';

    if (ev.key === 'ArrowRight') {
      if (expandable && !expanded) {
        ev.preventDefault();
        this._togglePath(path);
        this._focusByPath(path);
      } else if (expandable && expanded) {
        ev.preventDefault();
        // Move to first child if any.
        const firstChild = target.querySelector('ul.children > [role="treeitem"]') as HTMLElement | null;
        firstChild?.focus();
      }
    } else if (ev.key === 'ArrowLeft') {
      if (expandable && expanded) {
        ev.preventDefault();
        this._togglePath(path);
        this._focusByPath(path);
      } else {
        // Move to parent
        const parent = target.parentElement?.closest('[role="treeitem"]') as HTMLElement | null;
        if (parent) {
          ev.preventDefault();
          parent.focus();
        }
      }
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this._moveFocus(target, +1);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this._moveFocus(target, -1);
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      if (expandable) {
        ev.preventDefault();
        this._togglePath(path);
        this._focusByPath(path);
      }
    }
  }

  private _togglePath(path: string): void {
    if (this._expandedPaths.has(path)) this._expandedPaths.delete(path);
    else this._expandedPaths.add(path);
    this._render();
  }

  private _focusByPath(path: string): void {
    if (!this._list) return;
    const el = this._list.querySelector(`[role="treeitem"][data-path="${escapeAttrSelector(path)}"]`) as HTMLElement | null;
    el?.focus();
  }

  private _moveFocus(current: HTMLElement, delta: number): void {
    if (!this._list) return;
    const all = Array.from(
      this._list.querySelectorAll('[role="treeitem"]'),
    ) as HTMLElement[];
    const visible = all.filter((el) => el.offsetParent !== null || el === current);
    const idx = visible.indexOf(current);
    if (idx < 0) return;
    const next = visible[idx + delta];
    if (next) {
      // make current non-tabbable, next tabbable
      current.tabIndex = -1;
      next.tabIndex = 0;
      next.focus();
    }
  }
}

function escapeAttrSelector(s: string): string {
  return s.replace(/[\\"]/g, '\\$&');
}

AtlasElement.define('atlas-json-view', AtlasJsonView);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-json-view': AtlasJsonView;
  }
}
