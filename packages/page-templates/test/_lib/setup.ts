/**
 * Shared test setup for the page-templates dry-run scripts.
 *
 * Why this file exists:
 *   The five sibling dry-run files (dry-run.ts, editor-dry-run.ts,
 *   layout-dry-run.ts, layout-editor-dry-run.ts, dnd-dry-run.ts) all need
 *   the same linkedom-backed browser-ish global environment installed
 *   BEFORE they `await import('../src/...')`. Pre-refactor each file
 *   inlined the same shim — five copies of `(globalThis as unknown as
 *   Record<string, unknown>)['HTMLElement'] = dom.HTMLElement` and
 *   friends, each tripping the type-safety baseline.
 *
 *   This module concentrates all of those casts at ONE site (clearly
 *   marked as a linkedom DOM-shape boundary, per the project's
 *   documented suppression convention) and exports clean typed bindings
 *   that downstream test files use without any further casts.
 *
 *   The shared vitest setup (`/test-setup/linkedom-shims.ts`) is for
 *   vitest's global setup and is NOT importable here — vitest wires it
 *   via config. Dry-run scripts run under raw `tsx`, so they need this
 *   sibling pre-import shim. Same intent, different call site.
 */

/* eslint-disable atlas-widgets/no-double-cast, @typescript-eslint/no-unsafe-type-assertion --
 * boundary: linkedom-DOM-shape. `parseHTML` returns a single opaque
 * structurally-typed object whose `document`, `HTMLElement`, etc. fields
 * carry linkedom's internal types — not the standard-lib DOM types our
 * test code (and the @atlas/* packages under test) expect. The blanket
 * disable is scoped to this shim file only; downstream test files
 * consume the typed exports below with zero further casts.
 */

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The interface declares ONLY the surface the dry-run tests actually use,
// so we can assign to `globalThis` at a single well-typed site.
interface LinkedomDom {
  window: unknown;
  document: Document;
  HTMLElement: typeof HTMLElement;
  HTMLInputElement: typeof HTMLInputElement;
  DocumentFragment: typeof DocumentFragment;
  customElements: CustomElementRegistry;
  Node: typeof Node;
  Event: typeof Event;
  CustomEvent: typeof CustomEvent;
  NodeFilter?: { SHOW_ELEMENT: number };
}

const dom = parseHTML(
  '<!doctype html><html><head></head><body></body></html>',
) as unknown as LinkedomDom;

// Install globals once. Subsequent imports of this module are no-ops.
interface InstallFlag {
  __atlasPageTemplatesDryRunShimInstalled?: boolean;
}
const flag = globalThis as InstallFlag;
if (!flag.__atlasPageTemplatesDryRunShimInstalled) {
  flag.__atlasPageTemplatesDryRunShimInstalled = true;

  interface GlobalDomBag {
    window: unknown;
    document: Document;
    HTMLElement: typeof HTMLElement;
    HTMLInputElement: typeof HTMLInputElement;
    DocumentFragment: typeof DocumentFragment;
    customElements: CustomElementRegistry;
    Node: typeof Node;
    Event: typeof Event;
    CustomEvent: typeof CustomEvent;
    NodeFilter: { SHOW_ELEMENT: number };
    structuredClone: typeof structuredClone;
  }
  const bag = globalThis as unknown as GlobalDomBag;
  bag.window = dom.window;
  bag.document = dom.document;
  bag.HTMLElement = dom.HTMLElement;
  if (dom.HTMLInputElement) bag.HTMLInputElement = dom.HTMLInputElement;
  bag.DocumentFragment = dom.DocumentFragment;
  bag.customElements = dom.customElements;
  bag.Node = dom.Node;
  bag.Event = dom.Event;
  bag.CustomEvent = dom.CustomEvent;
  bag.NodeFilter = dom.NodeFilter ?? { SHOW_ELEMENT: 1 };

  if (!globalThis.structuredClone) {
    bag.structuredClone = ((v: unknown): unknown =>
      JSON.parse(JSON.stringify(v))) as typeof structuredClone;
  }

  // linkedom doesn't implement createTreeWalker; @atlas/core's html
  // tagged template uses it. A minimal walker is enough for the tests
  // that touch html``.
  interface TreeWalkerLike {
    nextNode(): Element | null;
  }
  interface TreeWalkerHost {
    createTreeWalker?: (root: Element) => TreeWalkerLike;
  }
  const docWithWalker = dom.document as unknown as TreeWalkerHost;
  if (typeof docWithWalker.createTreeWalker !== 'function') {
    docWithWalker.createTreeWalker = (root: Element): TreeWalkerLike => {
      const elements: Element[] = [];
      const walk = (el: Element): void => {
        elements.push(el);
        const children = el.children as unknown as Iterable<Element>;
        for (const child of children ?? []) walk(child);
      };
      const rootChildren = root.children as unknown as Iterable<Element>;
      for (const child of rootChildren ?? []) walk(child);
      let i = -1;
      return {
        nextNode(): Element | null {
          i += 1;
          return i < elements.length ? (elements[i] ?? null) : null;
        },
      };
    };
  }
}

/* eslint-enable atlas-widgets/no-double-cast, @typescript-eslint/no-unsafe-type-assertion */

/** Linkedom-backed `document` global, typed as standard-lib Document. */
export const document: Document = dom.document;

/** Linkedom-backed `HTMLElement` constructor — use for `extends HTMLElement`. */
export const HTMLElementCtor: typeof HTMLElement = dom.HTMLElement;

/** Linkedom-backed `customElements` registry. */
export const customElements: CustomElementRegistry = dom.customElements;

/** Linkedom-backed `Event` constructor — Node's native `Event` is
 *  incompatible with linkedom's dispatch path, so use this one. */
export const LinkedomEvent: typeof Event = dom.Event;

/**
 * Load and parse a JSON fixture from `specs/fixtures/`.
 *
 * The cast carries the test author's stated shape — fixtures are pinned
 * by file path and validated against canonical JSON Schemas by
 * `pnpm sync-schemas`, so a structural mismatch is a test-author bug at
 * scope time, not runtime data we have to validate.
 */
export function loadFixture<T>(name: string): T {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturesDir = resolve(here, '../../../../specs/fixtures');
  const raw = readFileSync(resolve(fixturesDir, name), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: JSON fixture is structurally typed by the test author against a schema-pinned file path; a mismatch is a test-author bug at scope time, not runtime data we have to validate.
  return parsed as T;
}

/** Dispatch a fresh `Event` of the given name on `target`. */
export function dispatchEventOn(target: Element, name: string): void {
  target.dispatchEvent(new LinkedomEvent(name, { bubbles: true }));
}

/**
 * Set the value of an `<input>` and dispatch a `change` event.
 * No-ops if `input` is null (mirrors the pre-refactor convenience).
 */
export function setInputValueAndChange(
  input: HTMLInputElement | null,
  value: number | string,
): void {
  if (!input) return;
  input.value = String(value);
  input.dispatchEvent(new LinkedomEvent('change', { bubbles: true }));
}
