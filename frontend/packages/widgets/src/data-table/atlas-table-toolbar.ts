import { AtlasElement } from '@atlas/core';

/**
 * <atlas-table-toolbar> — container for filter inputs above an
 * <atlas-data-table>. Light-DOM, styled by ../styles.css.
 *
 * The toolbar renders a per-column filter input for every column whose
 * config declares `{ filter: { type: 'text' | 'select' | ... } }`.
 * Filter values are pushed to the core via the enclosing
 * <atlas-data-table>'s event handler; the toolbar itself just emits
 * `filter-change` events.
 */
class AtlasTableToolbar extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'group');
    this.setAttribute('aria-label', 'Filters');
  }
}

AtlasElement.define('atlas-table-toolbar', AtlasTableToolbar);
