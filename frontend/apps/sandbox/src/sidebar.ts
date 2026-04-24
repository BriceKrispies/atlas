/**
 * <atlas-sandbox-sidebar> — app-local custom element that owns the
 * sidebar UI (search + category switcher + subcategory-grouped nav).
 *
 * Data in via properties; interaction out via events. The parent shell
 * owns all state; this element is a view.
 *
 *   Properties:
 *     specimens          (readonly ResolvedSpecimen[])
 *     activeCategory     (Category)
 *     activeSpecimenId   (string | null)
 *     searchValue        (string)
 *
 *   Events (composed, bubbling):
 *     specimen-select   detail: { id: string }
 *     category-change   detail: { category: Category }
 *     search-change     detail: { value: string }
 */

import { AtlasElement } from '@atlas/core';
import { adoptAtlasStyles } from '@atlas/design/shared-styles';
import '@atlas/design';
import { CATEGORIES, type Category } from './registry/index.ts';
import type { ResolvedSpecimen } from './sandbox-app.ts';

const styles = `
  :host {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    background: var(--atlas-color-surface);
    font-family: var(--atlas-font-family);
    color: var(--atlas-color-text);
  }
  .header {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--atlas-space-sm);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border-bottom: 1px solid var(--atlas-color-border);
  }
  .scroll {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: var(--atlas-space-sm) 0;
  }
  .scroll atlas-heading[level="3"] {
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    margin-top: var(--atlas-space-sm);
  }
  .scroll atlas-heading[level="3"]:first-child {
    margin-top: 0;
  }
  atlas-nav-item.item[aria-selected="true"] {
    background: var(--atlas-color-primary-subtle);
    color: var(--atlas-color-primary);
    font-weight: var(--atlas-font-weight-medium);
  }
  .empty {
    padding: var(--atlas-space-md);
    color: var(--atlas-color-text-muted);
    font-size: var(--atlas-font-size-sm);
  }
  atlas-tab-bar { width: 100%; }
`;

function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function matchesSearch(spec: ResolvedSpecimen, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (spec.name.toLowerCase().includes(needle)) return true;
  if (spec.id.toLowerCase().includes(needle)) return true;
  if (spec.tag.toLowerCase().includes(needle)) return true;
  for (const tag of spec.tags) if (tag.toLowerCase().includes(needle)) return true;
  return false;
}

export class AtlasSandboxSidebar extends AtlasElement {
  private _specimens: readonly ResolvedSpecimen[] = [];
  private _activeCategory: Category = 'primitives';
  private _activeSpecimenId: string | null = null;
  private _searchValue = '';
  private _built = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    adoptAtlasStyles(this.shadowRoot as unknown as ShadowRoot);
  }

  get specimens(): readonly ResolvedSpecimen[] {
    return this._specimens;
  }
  set specimens(next: readonly ResolvedSpecimen[]) {
    this._specimens = next;
    this._renderList();
  }

  get activeCategory(): Category {
    return this._activeCategory;
  }
  set activeCategory(next: Category) {
    if (next === this._activeCategory) return;
    this._activeCategory = next;
    this._syncCategoryBar();
    this._renderList();
  }

  get activeSpecimenId(): string | null {
    return this._activeSpecimenId;
  }
  set activeSpecimenId(next: string | null) {
    if (next === this._activeSpecimenId) return;
    this._activeSpecimenId = next;
    this._syncSelection();
  }

  get searchValue(): string {
    return this._searchValue;
  }
  set searchValue(next: string) {
    if (next === this._searchValue) return;
    this._searchValue = next;
    this._syncSearchInput();
    this._renderList();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._build();
  }

  private _build(): void {
    if (this._built) return;
    const root = this.shadowRoot as ShadowRoot;
    root.innerHTML = `
      <style>${styles}</style>
      <div class="header" part="header">
        <atlas-search-input
          name="specimen-search"
          placeholder="Search specimens…"
          aria-label="Search specimens"
          data-testid="sandbox.search"
        ></atlas-search-input>
        <atlas-tab-bar
          name="category"
          size="sm"
          stretch
          aria-label="Specimen category"
          data-role="category-switcher"
        ></atlas-tab-bar>
      </div>
      <div class="scroll" part="scroll" data-role="scroll"></div>
    `;

    const catBar = root.querySelector(
      'atlas-tab-bar[data-role="category-switcher"]',
    ) as HTMLElement & { tabs: Array<{ value: string; label: string }>; value: string };
    catBar.tabs = CATEGORIES.map((c) => ({ value: c.id, label: c.label }));
    catBar.value = this._activeCategory;
    catBar.addEventListener('change', (ev: Event) => {
      const detail = (ev as CustomEvent<{ value: string }>).detail;
      const next = CATEGORIES.find((c) => c.id === detail.value)?.id;
      if (!next || next === this._activeCategory) return;
      this._activeCategory = next;
      this._renderList();
      this.dispatchEvent(
        new CustomEvent('category-change', {
          detail: { category: next },
          bubbles: true,
          composed: true,
        }),
      );
    });

    const search = root.querySelector(
      'atlas-search-input[name="specimen-search"]',
    ) as HTMLElement & { value: string };
    if (this._searchValue) search.value = this._searchValue;
    // Live sidebar filter: refresh the specimen list per keystroke.
    // Phase 2a moved per-keystroke semantics onto `input`; `change`
    // now fires only on blur/commit.
    search.addEventListener('input', (ev: Event) => {
      const detail = (ev as CustomEvent<{ value: string }>).detail;
      const v = detail.value ?? '';
      if (v === this._searchValue) return;
      this._searchValue = v;
      this._renderList();
      this.dispatchEvent(
        new CustomEvent('search-change', {
          detail: { value: v },
          bubbles: true,
          composed: true,
        }),
      );
    });

    const scroll = root.querySelector('[data-role="scroll"]');
    scroll?.addEventListener('click', (e) => {
      const target = e.target as Element | null;
      const item = target?.closest('atlas-nav-item.item') as HTMLElement | null;
      if (!item) return;
      const id = item.dataset['id'];
      if (!id) return;
      this.dispatchEvent(
        new CustomEvent('specimen-select', {
          detail: { id },
          bubbles: true,
          composed: true,
        }),
      );
    });

    this._built = true;
    this._renderList();
  }

  private _syncCategoryBar(): void {
    const bar = this.shadowRoot?.querySelector(
      'atlas-tab-bar[data-role="category-switcher"]',
    ) as (HTMLElement & { value: string }) | null;
    if (bar) bar.value = this._activeCategory;
  }

  private _syncSearchInput(): void {
    const input = this.shadowRoot?.querySelector(
      'atlas-search-input[name="specimen-search"]',
    ) as (HTMLElement & { value: string }) | null;
    if (input && input.value !== this._searchValue) input.value = this._searchValue;
  }

  private _syncSelection(): void {
    const root = this.shadowRoot;
    if (!root) return;
    for (const el of Array.from(root.querySelectorAll('atlas-nav-item.item'))) {
      const item = el as HTMLElement;
      const isActive = item.dataset['id'] === this._activeSpecimenId;
      item.setAttribute('aria-selected', isActive ? 'true' : 'false');
      if (isActive) item.setAttribute('active', '');
      else item.removeAttribute('active');
    }
  }

  private _renderList(): void {
    if (!this._built) return;
    const root = this.shadowRoot as ShadowRoot;
    const scroll = root.querySelector('[data-role="scroll"]');
    if (!scroll) return;

    const visible = this._specimens.filter(
      (s) => s.category === this._activeCategory && matchesSearch(s, this._searchValue),
    );

    if (visible.length === 0) {
      const msg = this._searchValue
        ? `No specimens match “${escapeHtml(this._searchValue)}”.`
        : 'No specimens in this category yet.';
      scroll.innerHTML = `<div class="empty" data-testid="sandbox.sidebar-empty">${msg}</div>`;
      return;
    }

    const groups: Record<string, ResolvedSpecimen[]> = {};
    for (const spec of visible) {
      (groups[spec.subcategory] ??= []).push(spec);
    }

    let navHtml = '';
    for (const [group, items] of Object.entries(groups)) {
      navHtml += `<atlas-heading level="3">${escapeHtml(group)}</atlas-heading>`;
      for (const item of items) {
        const selected = item.id === this._activeSpecimenId;
        navHtml += `<atlas-nav-item class="item" data-id="${item.id}" role="option" aria-selected="${selected}"${selected ? ' active' : ''}>${escapeHtml(item.name)}</atlas-nav-item>`;
      }
    }
    scroll.innerHTML = `<atlas-nav label="Specimens">${navHtml}</atlas-nav>`;
  }
}

AtlasElement.define('atlas-sandbox-sidebar', AtlasSandboxSidebar);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-sandbox-sidebar': AtlasSandboxSidebar;
  }
}
