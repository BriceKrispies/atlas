/**
 * layout-element.ts — `<atlas-layout>` runtime element.
 *
 * A data-driven alternative to the hand-coded template classes
 * (`<template-two-column>` etc.). Reads a layout document and renders
 * its slot grid. A `<widget-host>` child populates each section with
 * widgets from a page document; `<atlas-layout>` owns the section
 * elements (and their inline grid-column / grid-row positioning) so
 * `widget-host` can re-mount widgets without disturbing slot layout.
 */

import { AtlasElement } from '@atlas/core';

import { validateLayoutDocument, type LayoutDocument } from './layout-document.ts';
import { ensureLayoutStyles } from './layout-styles.ts';

export class AtlasLayoutElement extends AtlasElement {
  static surfaceId = 'atlas-layout';

  private _layout: LayoutDocument | null = null;

  // AtlasElement has its own `_applyTestId`; keep as internal helper.
  private _applyTestIdSafe(): void {
    (this as unknown as { _applyTestId?: () => void })._applyTestId?.();
  }

  override connectedCallback(): void {
    // Bypass AtlasElement's reactive render path — this element mutates
    // its own light-DOM children imperatively in response to `.layout`.
    this._applyTestIdSafe();
    ensureLayoutStyles(this);
    this._apply();
  }

  override disconnectedCallback(): void {
    // Intentionally leave DOM alone — the containing surface
    // (`<content-page>`, the layout editor) decides when to tear down.
  }

  set layout(value: LayoutDocument | null) {
    this._layout = value;
    if (this.isConnected) this._apply();
  }

  get layout(): LayoutDocument | null {
    return this._layout;
  }

  /**
   * Imperative re-sync. Consumers call this after nested DOM mutations
   * (e.g. adding a `<widget-host>` after construction) so slot sections
   * get reconciled.
   */
  refresh(): void {
    this._apply();
  }

  // ---- internal ----

  private _apply(): void {
    const doc = this._layout;
    if (!doc) return;
    const result = validateLayoutDocument(doc);
    if (!result.ok) {
      // eslint-disable-next-line no-console
      console.error('[atlas-layout] invalid layout document', result.errors);
      return;
    }

    // Apply grid CSS to the host element inline so each instance can
    // drive its own column count / row height / gap from data.
    this.style.gridTemplateColumns = `repeat(${doc.grid.columns}, minmax(0, 1fr))`;
    this.style.gridAutoRows = `${doc.grid.rowHeight}px`;
    this.style.gap = `${doc.grid.gap}px`;
    this.setAttribute('data-layout-id', doc.layoutId);

    // Pick the section parent: a <widget-host> child if present (normal
    // case), otherwise <atlas-layout> itself (useful for preview-only).
    const host: Element =
      this.querySelector(':scope > widget-host') ?? this;

    const existing = new Map<string, HTMLElement>();
    for (const sec of host.querySelectorAll(':scope > section[data-slot]')) {
      existing.set(sec.getAttribute('data-slot') ?? '', sec as HTMLElement);
    }

    for (const slot of doc.slots) {
      let sec = existing.get(slot.name);
      if (!sec) {
        sec = document.createElement('section');
        sec.setAttribute('data-slot', slot.name);
        host.appendChild(sec);
      } else {
        existing.delete(slot.name);
      }
      sec.style.gridColumn = `${slot.col} / span ${slot.colSpan}`;
      sec.style.gridRow = `${slot.row} / span ${slot.rowSpan}`;
    }

    // Slots removed from the layout → drop their sections.
    for (const sec of existing.values()) {
      sec.remove();
    }
  }
}

if (typeof customElements !== 'undefined') {
  AtlasElement.define('atlas-layout', AtlasLayoutElement);
}
