import { AtlasElement } from '@atlas/core';
import type { AtlasTreeItem } from './atlas-tree-item.ts';

/**
 * <atlas-tree> — hierarchical tree view (WAI-ARIA tree pattern).
 *
 * Light-DOM container of `<atlas-tree-item>` children, each of which
 * may itself contain nested `<atlas-tree-item>` children. The tree
 * owns:
 *   - selection mode (`selection="none|single|multiple"`)
 *   - keyboard routing (Arrow Up/Down/Left/Right, Home, End, Enter, Space)
 *   - roving tabindex (only one item is in tab order at a time)
 *   - emitting `select`, `expand`, `collapse` events with `{ value }`.
 *
 * Each child's expand/collapse and selection state is mutated
 * SURGICALLY via the tree-item's `setExpanded` / `setSelected` /
 * `setTabbable` methods — never by re-rendering the whole tree (per
 * the "Do NOT" list in the brief and the C13.4 / render-pipeline rule).
 *
 * Attributes:
 *   selection — none (default) | single | multiple
 *   label     — accessible name applied via aria-label.
 */
export class AtlasTree extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['selection', 'label'];
  }

  private _wired = false;
  private _activeItem: AtlasTreeItem | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'tree');
    const label = this.getAttribute('label');
    if (label) this.setAttribute('aria-label', label);
    const sel = this.getAttribute('selection') ?? 'none';
    if (sel === 'multiple') this.setAttribute('aria-multiselectable', 'true');
    else this.removeAttribute('aria-multiselectable');

    if (!this._wired) {
      this.addEventListener('click', this._onClick);
      this.addEventListener('keydown', this._onKeydown);
      this.addEventListener('focusin', this._onFocusIn);
      this._wired = true;
    }

    this._initLevels();
    this._initRovingTabindex();
  }

  override attributeChangedCallback(name: string): void {
    if (name === 'label') {
      const label = this.getAttribute('label');
      if (label) this.setAttribute('aria-label', label);
      else this.removeAttribute('aria-label');
    }
    if (name === 'selection') {
      const sel = this.getAttribute('selection') ?? 'none';
      if (sel === 'multiple') this.setAttribute('aria-multiselectable', 'true');
      else this.removeAttribute('aria-multiselectable');
    }
  }

  // ── Public API ───────────────────────────────────────────────

  /** Get all currently-selected values, in DOM order. */
  getSelectedValues(): string[] {
    return this._allItems()
      .filter((it) => it.hasAttribute('selected'))
      .map((it) => it.getAttribute('value') ?? '');
  }

  // ── Internal: roving tabindex ────────────────────────────────

  private _initLevels(): void {
    const walk = (parent: Element, level: number): void => {
      const kids = Array.from(
        parent.querySelectorAll(':scope > atlas-tree-item'),
      ) as AtlasTreeItem[];
      for (const kid of kids) {
        kid.setLevel(level);
        walk(kid, level + 1);
      }
    };
    walk(this, 1);
  }

  private _initRovingTabindex(): void {
    const items = this._visibleItems();
    if (items.length === 0) return;
    const selected = items.find((it) => it.hasAttribute('selected'));
    const initial = selected ?? items[0];
    if (!initial) return;
    for (const it of this._allItems()) it.setTabbable(false);
    initial.setTabbable(true);
    this._activeItem = initial;
  }

  // ── Internal: walking ───────────────────────────────────────

  private _allItems(): AtlasTreeItem[] {
    return Array.from(this.querySelectorAll('atlas-tree-item')) as AtlasTreeItem[];
  }

  /** Items currently visible (not under a collapsed ancestor). */
  private _visibleItems(): AtlasTreeItem[] {
    const out: AtlasTreeItem[] = [];
    const walk = (parent: Element): void => {
      const kids = Array.from(
        parent.querySelectorAll(':scope > atlas-tree-item'),
      ) as AtlasTreeItem[];
      for (const kid of kids) {
        out.push(kid);
        if (kid.hasAttribute('expanded')) walk(kid);
      }
    };
    walk(this);
    return out;
  }

  private _parentItem(item: AtlasTreeItem): AtlasTreeItem | null {
    const p = item.parentElement;
    if (p && p.tagName.toLowerCase() === 'atlas-tree-item') return p as AtlasTreeItem;
    return null;
  }

  // ── Internal: events ────────────────────────────────────────

  private readonly _onClick = (ev: Event): void => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const item = target.closest('atlas-tree-item') as AtlasTreeItem | null;
    if (!item || !this.contains(item)) return;
    if (item.hasAttribute('disabled')) return;
    // Click toggles expansion if it has children; click also focuses
    // and (in single/multiple modes) selects.
    this._setActive(item);
    if (item.hasChildren()) {
      this._toggle(item);
    }
    this._activate(item, ev as MouseEvent);
  };

  private readonly _onFocusIn = (ev: FocusEvent): void => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const item = target.closest('atlas-tree-item') as AtlasTreeItem | null;
    if (!item || !this.contains(item)) return;
    if (item === this._activeItem) return;
    // Slide the roving tabindex to whichever item just received focus.
    this._setActive(item);
  };

  private readonly _onKeydown = (ev: KeyboardEvent): void => {
    const active = this._activeItem;
    if (!active || !this.contains(active)) return;
    const visible = this._visibleItems();
    const idx = visible.indexOf(active);
    if (idx < 0) return;
    let target: AtlasTreeItem | null = null;
    switch (ev.key) {
      case 'ArrowDown':
        target = visible[idx + 1] ?? null;
        break;
      case 'ArrowUp':
        target = visible[idx - 1] ?? null;
        break;
      case 'Home':
        target = visible[0] ?? null;
        break;
      case 'End':
        target = visible[visible.length - 1] ?? null;
        break;
      case 'ArrowRight':
        if (active.hasChildren() && !active.hasAttribute('expanded')) {
          this._expand(active);
        } else if (active.hasChildren() && active.hasAttribute('expanded')) {
          target = visible[idx + 1] ?? null;
        }
        break;
      case 'ArrowLeft':
        if (active.hasChildren() && active.hasAttribute('expanded')) {
          this._collapse(active);
        } else {
          target = this._parentItem(active);
        }
        break;
      case 'Enter':
      case ' ':
        ev.preventDefault();
        this._activate(active, ev);
        return;
      default:
        return;
    }
    ev.preventDefault();
    if (target) this._setActive(target, true);
  };

  private _setActive(item: AtlasTreeItem, focus: boolean = false): void {
    if (this._activeItem && this._activeItem !== item) this._activeItem.setTabbable(false);
    item.setTabbable(true);
    this._activeItem = item;
    if (focus) item.focus();
  }

  private _toggle(item: AtlasTreeItem): void {
    if (item.hasAttribute('expanded')) this._collapse(item);
    else this._expand(item);
  }

  private _expand(item: AtlasTreeItem): void {
    if (!item.hasChildren()) return;
    if (item.hasAttribute('expanded')) return;
    item.setExpanded(true);
    this.dispatchEvent(
      new CustomEvent<{ value: string }>('expand', {
        detail: { value: item.getAttribute('value') ?? '' },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _collapse(item: AtlasTreeItem): void {
    if (!item.hasChildren()) return;
    if (!item.hasAttribute('expanded')) return;
    item.setExpanded(false);
    this.dispatchEvent(
      new CustomEvent<{ value: string }>('collapse', {
        detail: { value: item.getAttribute('value') ?? '' },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _activate(item: AtlasTreeItem, ev: MouseEvent | KeyboardEvent): void {
    const mode = this.getAttribute('selection') ?? 'none';
    if (mode === 'none') return;
    if (item.hasAttribute('disabled')) return;
    if (mode === 'single') {
      for (const it of this._allItems()) {
        if (it !== item && it.hasAttribute('selected')) it.setSelected(false);
      }
      item.setSelected(true);
    } else {
      // Multiple: Ctrl/Meta toggles, plain click/Enter selects this
      // alone if it wasn't already; otherwise toggles.
      const additive = ev.ctrlKey || ev.metaKey || ev.shiftKey;
      if (additive) {
        item.setSelected(!item.hasAttribute('selected'));
      } else {
        for (const it of this._allItems()) {
          if (it !== item && it.hasAttribute('selected')) it.setSelected(false);
        }
        item.setSelected(true);
      }
    }
    this.dispatchEvent(
      new CustomEvent<{ value: string }>('select', {
        detail: { value: item.getAttribute('value') ?? '' },
        bubbles: true,
        composed: true,
      }),
    );
    const elName = this.getAttribute('name');
    if (elName && this.surfaceId) {
      this.emit(`${this.surfaceId}.${elName}-changed`, {
        value: item.getAttribute('value') ?? '',
        selected: this.getSelectedValues(),
      });
    }
  }
}

AtlasElement.define('atlas-tree', AtlasTree);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-tree': AtlasTree;
  }
}
