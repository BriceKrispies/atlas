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
import type { ResolvedSpecimen } from './specimen-types.ts';
import { must, isElement, isHtmlElement, customDetail, isValueDetail } from './internal/assert.ts';
const styles = `
  :host {
    display: grid;
    grid-template-columns: minmax(0, 200px) minmax(0, 1fr);
    grid-template-rows: auto 1fr;
    grid-template-areas:
      "header header"
      "cats   list";
    min-height: 0;
    height: 100%;
    background: var(--atlas-color-surface);
    font-family: var(--atlas-font-family);
    color: var(--atlas-color-text);
  }
  .header {
    grid-area: header;
    display: flex;
    flex-direction: column;
    gap: var(--atlas-space-sm);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border-bottom: 1px solid var(--atlas-color-border);
  }
  .categories {
    grid-area: cats;
    overflow-y: auto;
    padding: var(--atlas-space-sm) 0;
    border-right: 1px solid var(--atlas-color-border);
    background: var(--atlas-color-surface);
  }
  .scroll {
    grid-area: list;
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
  atlas-nav-item.item[aria-selected="true"],
  atlas-nav-item.cat[aria-selected="true"] {
    background: var(--atlas-color-primary-subtle);
    color: var(--atlas-color-primary);
    font-weight: var(--atlas-font-weight-medium);
  }
  .empty {
    padding: var(--atlas-space-md);
    color: var(--atlas-color-text-muted);
    font-size: var(--atlas-font-size-sm);
  }
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
    if (!q)
        return true;
    const needle = q.toLowerCase();
    if (spec.name.toLowerCase().includes(needle))
        return true;
    if (spec.id.toLowerCase().includes(needle))
        return true;
    if (spec.tag.toLowerCase().includes(needle))
        return true;
    for (const tag of spec.tags)
        if (tag.toLowerCase().includes(needle))
            return true;
    return false;
}
export class AtlasSandboxSidebar extends AtlasElement {
    private _specimens: readonly ResolvedSpecimen[] = [];
    private _activeCategory: Category = 'foundations';
    private _activeSpecimenId: string | null = null;
    private _searchValue = '';
    private _built = false;
    /** Non-null view of the shadow root, captured right after attachShadow().
     *  Mirrors the pattern in `sandbox-app.ts`: avoids the `this.shadowRoot
     *  as unknown as ShadowRoot` cast that the no-double-cast rule blocks. */
    private readonly _root: ShadowRoot;
    constructor() {
        super();
        // attachShadow({mode:'open'}) both sets this.shadowRoot and returns
        // it; capture the return value so we have a typed, non-null handle.
        this._root = this.attachShadow({ mode: 'open' });
        adoptAtlasStyles(this._root);
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
        if (next === this._activeCategory)
            return;
        this._activeCategory = next;
        this._syncCategoryBar();
        this._renderList();
    }
    get activeSpecimenId(): string | null {
        return this._activeSpecimenId;
    }
    set activeSpecimenId(next: string | null) {
        if (next === this._activeSpecimenId)
            return;
        this._activeSpecimenId = next;
        this._syncSelection();
    }
    get searchValue(): string {
        return this._searchValue;
    }
    set searchValue(next: string) {
        if (next === this._searchValue)
            return;
        this._searchValue = next;
        this._syncSearchInput();
        this._renderList();
    }
    override connectedCallback(): void {
        super.connectedCallback();
        this._build();
    }
    private _build(): void {
        if (this._built)
            return;
        const root = this._root;
        root.innerHTML = `
      <style>${styles}</style>
      <div class="header" part="header">
        <atlas-search-input
          name="specimen-search"
          placeholder="Search specimens…"
          aria-label="Search specimens"
          data-testid="sandbox.search"
        ></atlas-search-input>
      </div>
      <div class="categories" part="categories" data-role="category-switcher" aria-label="Specimen category"></div>
      <div class="scroll" part="scroll" data-role="scroll"></div>
    `;
        this._renderCategories();
        const cats = root.querySelector('[data-role="category-switcher"]');
        cats?.addEventListener('click', (e) => {
            if (!isElement(e.target))
                return;
            const item = e.target.closest('atlas-nav-item.cat');
            if (!isHtmlElement(item))
                return;
            const raw = item.dataset['value'];
            // Narrow string → Category by lookup against the typed registry.
            const next = raw === undefined
                ? undefined
                : CATEGORIES.find(function (c) {
                    return c.id === raw;
                })?.id;
            if (!next || next === this._activeCategory)
                return;
            this._activeCategory = next;
            this._syncCategoryBar();
            this._renderList();
            this.dispatchEvent(new CustomEvent('category-change', {
                detail: { category: next },
                bubbles: true,
                composed: true,
            }));
        });
        // <atlas-search-input> is registered in HTMLElementTagNameMap (see
        // packages/design/src/atlas-search-input.ts), so querying by the bare
        // tag returns the typed AtlasSearchInput class with its `.value`
        // setter directly. A compound selector (`tag[attr=…]`) would fall
        // back to Element, so we filter the attribute imperatively.
        const search = must(root.querySelector('atlas-search-input'), 'sidebar: <atlas-search-input> just rendered into shadow root');
        if (this._searchValue)
            search.value = this._searchValue;
        // Live sidebar filter: refresh the specimen list per keystroke.
        // Phase 2a moved per-keystroke semantics onto `input`; `change`
        // now fires only on blur/commit.
        search.addEventListener('input', (ev: Event) => {
            const detail = customDetail(ev, isValueDetail, 'sidebar.search-input');
            const v = detail.value;
            if (v === this._searchValue)
                return;
            this._searchValue = v;
            this._renderList();
            this.dispatchEvent(new CustomEvent('search-change', {
                detail: { value: v },
                bubbles: true,
                composed: true,
            }));
        });
        const scroll = root.querySelector('[data-role="scroll"]');
        scroll?.addEventListener('click', (e) => {
            if (!isElement(e.target))
                return;
            const item = e.target.closest('atlas-nav-item.item');
            if (!isHtmlElement(item))
                return;
            const id = item.dataset['id'];
            if (!id)
                return;
            this.dispatchEvent(new CustomEvent('specimen-select', {
                detail: { id },
                bubbles: true,
                composed: true,
            }));
        });
        this._built = true;
        this._renderList();
    }
    private _renderCategories(): void {
        const cats = this._root.querySelector('[data-role="category-switcher"]');
        if (!cats)
            return;
        let html = '<atlas-nav label="Categories">';
        for (const c of CATEGORIES) {
            const selected = c.id === this._activeCategory;
            html += `<atlas-nav-item class="cat" data-value="${c.id}" role="option" aria-selected="${selected}"${selected ? ' active' : ''}>${escapeHtml(c.label)}</atlas-nav-item>`;
        }
        html += '</atlas-nav>';
        cats.innerHTML = html;
    }
    private _syncCategoryBar(): void {
        // querySelectorAll with a compound selector (`tag.class`) falls back
        // to Element in TS's lib types — the HTMLElementTagNameMap match only
        // hits bare tags. Filter through `isHtmlElement` so we can read
        // `dataset` and call `setAttribute` without a structural cast.
        for (const el of this._root.querySelectorAll('atlas-nav-item.cat')) {
            if (!isHtmlElement(el))
                continue;
            const isActive = el.dataset['value'] === this._activeCategory;
            el.setAttribute('aria-selected', isActive ? 'true' : 'false');
            if (isActive)
                el.setAttribute('active', '');
            else
                el.removeAttribute('active');
        }
    }
    private _syncSearchInput(): void {
        // Bare-tag query so HTMLElementTagNameMap resolves to AtlasSearchInput.
        const input = this._root.querySelector('atlas-search-input');
        if (input && input.value !== this._searchValue)
            input.value = this._searchValue;
    }
    private _syncSelection(): void {
        // See `_syncCategoryBar` for the rationale behind the
        // `isHtmlElement` filter on a compound selector.
        for (const el of this._root.querySelectorAll('atlas-nav-item.item')) {
            if (!isHtmlElement(el))
                continue;
            const isActive = el.dataset['id'] === this._activeSpecimenId;
            el.setAttribute('aria-selected', isActive ? 'true' : 'false');
            if (isActive)
                el.setAttribute('active', '');
            else
                el.removeAttribute('active');
        }
    }
    private _renderList(): void {
        if (!this._built)
            return;
        const scroll = this._root.querySelector('[data-role="scroll"]');
        if (!scroll)
            return;
        const visible = this._specimens.filter((s) => s.category === this._activeCategory && matchesSearch(s, this._searchValue));
        if (visible.length === 0) {
            const msg = this._searchValue
                ? `No specimens match “${escapeHtml(this._searchValue)}”.`
                : 'No specimens in this category yet.';
            scroll.innerHTML = `<div class="empty" data-testid="sandbox.sidebar-empty">${msg}</div>`;
            return;
        }
        const flat: ResolvedSpecimen[] = [];
        const groups: Record<string, ResolvedSpecimen[]> = {};
        for (const spec of visible) {
            if (spec.subcategory)
                (groups[spec.subcategory] ??= []).push(spec);
            else
                flat.push(spec);
        }
        const renderItem = (item: ResolvedSpecimen): string => {
            const selected = item.id === this._activeSpecimenId;
            return `<atlas-nav-item class="item" data-id="${item.id}" role="option" aria-selected="${selected}"${selected ? ' active' : ''}>${escapeHtml(item.name)}</atlas-nav-item>`;
        };
        let navHtml = '';
        for (const item of flat)
            navHtml += renderItem(item);
        for (const [group, items] of Object.entries(groups)) {
            navHtml += `<atlas-heading level="3">${escapeHtml(group)}</atlas-heading>`;
            for (const item of items)
                navHtml += renderItem(item);
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
