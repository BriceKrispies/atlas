/**
 * layout-element.js — `<atlas-layout>` runtime element.
 *
 * A data-driven alternative to the hand-coded template classes
 * (`<template-two-column>` etc.). Reads a layout document and renders
 * its slot grid. A `<widget-host>` child populates each section with
 * widgets from a page document; `<atlas-layout>` owns the section
 * elements (and their inline grid-column / grid-row positioning) so
 * `widget-host` can re-mount widgets without disturbing slot layout.
 *
 * Contract:
 *   - Set `.layout = layoutDoc` to apply a layout.
 *   - A `<widget-host>` child may be placed inside; this element will
 *     ensure sections `<section data-slot="{name}">` exist as direct
 *     children of the widget-host, styled for grid placement.
 *   - If no `<widget-host>` is present, sections are placed as direct
 *     children of `<atlas-layout>` itself (useful for preview-only use
 *     in the layout editor).
 *
 * The element is light-DOM (no shadow) so CSS from the containing
 * document / template stylesheet still cascades into its sections.
 */

import { AtlasElement } from '@atlas/core';

import { validateLayoutDocument } from './layout-document.js';
import { ensureLayoutStyles } from './layout-styles.js';

export class AtlasLayoutElement extends AtlasElement {
  static surfaceId = 'atlas-layout';

  constructor() {
    super();
    /** @type {import('./layout-document.js').LayoutDocument | null} */
    this._layout = null;
  }

  connectedCallback() {
    // Bypass AtlasElement's reactive render path — this element mutates
    // its own light-DOM children imperatively in response to `.layout`.
    this._applyTestId?.();
    ensureLayoutStyles(this);
    this._apply();
  }

  disconnectedCallback() {
    // Intentionally leave DOM alone — the containing surface
    // (`<content-page>`, the layout editor) decides when to tear down.
  }

  set layout(value) {
    this._layout = value;
    if (this.isConnected) this._apply();
  }

  get layout() {
    return this._layout;
  }

  /**
   * Imperative re-sync. Consumers call this after nested DOM mutations
   * (e.g. adding a `<widget-host>` after construction) so slot sections
   * get reconciled.
   */
  refresh() {
    this._apply();
  }

  // ---- internal ----

  _apply() {
    const doc = this._layout;
    if (!doc) return;
    const { ok, errors } = validateLayoutDocument(doc);
    if (!ok) {
      // eslint-disable-next-line no-console
      console.error('[atlas-layout] invalid layout document', errors);
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
    const host = this.querySelector(':scope > widget-host') ?? this;

    const existing = new Map();
    for (const sec of host.querySelectorAll(':scope > section[data-slot]')) {
      existing.set(sec.getAttribute('data-slot'), sec);
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
