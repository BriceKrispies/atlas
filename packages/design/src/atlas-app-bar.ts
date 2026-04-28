import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet } from './util.ts';

/**
 * <atlas-app-bar> — top application bar (mobile chrome pattern).
 *
 * A first-class primitive that surfaces (pages, dialogs, drawers) compose
 * directly. The bar provides three slot regions:
 *
 *   leading  — typically a back arrow, hamburger, or close icon
 *   default  — title or heading content
 *   trailing — action buttons (search, more, save, etc.)
 *
 * Differs from the `shell-header` PATTERN: shell-header is a one-off
 * composition demonstrated in the sandbox under Patterns / Shell. This is
 * a reusable element with built-in scroll behaviour, slots, and landmark
 * semantics. Pages may use `<atlas-app-bar variant="shell">` to render the
 * dark shell-bg variant; otherwise the bar adopts the page surface palette.
 *
 * Attributes:
 *   variant         — `default` (default) | `shell` (dark, app chrome).
 *   scroll-behavior — `pin` (default) | `elevate` | `collapse`.
 *      pin      — bar is sticky and never hides.
 *      elevate  — bar is sticky and acquires a shadow once the page has
 *                 scrolled vertically more than ~4px.
 *      collapse — bar slides out when the user scrolls down and slides
 *                 back in when they scroll up (mobile chrome pattern).
 *   landmark        — when present (default `true`), the host gets
 *                     `role=banner`. Set `landmark="none"` to suppress
 *                     when nesting inside another banner (e.g. a dialog).
 *   name            — required for auto-testid via AtlasElement.
 *
 * Layout: 56px tall on phones, 64px ≥md (`--atlas-bp-md` = 900px).
 * No conflict with `<atlas-tab-bar>` (segmented picker) or
 * `<atlas-bottom-nav>` (thumb-reachable bottom tabs).
 */

const sheet = createSheet(`
  :host {
    /* Shell built once. Internal grid lays out the three slot regions
       so titles flex to fill while leading + trailing icons hold their
       intrinsic width. */
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--atlas-space-sm);
    box-sizing: border-box;
    width: 100%;
    min-height: 56px;
    padding: 0 var(--atlas-space-md);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    border-bottom: 1px solid var(--atlas-color-border);
    /* Pin behaviour relies on the bar being a positioned ancestor of
       its scroll context. Surfaces wrap their main scrolling region;
       app-bar itself is sticky-top by default. */
    position: sticky;
    top: 0;
    z-index: 20;
    transition:
      box-shadow var(--atlas-transition-fast),
      transform var(--atlas-transition-medium),
      background var(--atlas-transition-fast);
    -webkit-tap-highlight-color: transparent;
  }
  @media (min-width: 900px) {
    :host {
      min-height: 64px;
      padding: 0 var(--atlas-space-lg);
    }
  }

  /* Shell variant — dark app chrome bar. Used when the bar is the
     outermost top-level chrome of an app (admin shell, portal shell). */
  :host([variant="shell"]) {
    background: var(--atlas-color-shell-bg);
    color: var(--atlas-color-shell-text);
    border-bottom-color: transparent;
  }

  /* Elevate / collapse states are applied via attribute by the scroll
     observer below. Both attributes are managed internally — consumers
     toggle scroll-behavior, not data-elevated/data-hidden. */
  :host([data-elevated]) {
    box-shadow: var(--atlas-shadow-md);
    border-bottom-color: transparent;
  }
  :host([data-hidden]) {
    transform: translateY(-100%);
  }

  ::slotted([slot="leading"]),
  ::slotted([slot="trailing"]) {
    display: inline-flex;
    align-items: center;
    gap: var(--atlas-space-xs);
  }

  .title {
    /* Default slot is the title region. Long titles truncate rather than
       wrapping — chrome bars are a single line. */
    display: flex;
    align-items: center;
    min-width: 0;
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-md);
    font-weight: var(--atlas-font-weight-medium);
    line-height: 1.2;
    color: inherit;
    overflow: hidden;
  }
  .title ::slotted(*) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    :host {
      transition: none;
    }
  }
`);

export type AtlasAppBarScrollBehavior = 'pin' | 'elevate' | 'collapse';

export class AtlasAppBar extends AtlasElement {
  declare variant: string;
  declare scrollBehavior: string;

  static {
    Object.defineProperty(
      this.prototype,
      'variant',
      AtlasElement.strAttr('variant', 'default'),
    );
    Object.defineProperty(
      this.prototype,
      'scrollBehavior',
      AtlasElement.strAttr('scroll-behavior', 'pin'),
    );
  }

  static override get observedAttributes(): readonly string[] {
    return ['scroll-behavior', 'landmark'];
  }

  private _built = false;
  private _scrollListener: (() => void) | null = null;
  private _scrollContainer: (Window & typeof globalThis) | HTMLElement | null =
    null;
  private _lastScrollTop = 0;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) {
      this._buildShell();
      this._built = true;
    }
    this._syncLandmark();
    this._installScrollListener();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._removeScrollListener();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'scroll-behavior') {
      this._removeScrollListener();
      this._installScrollListener();
    }
    if (name === 'landmark') {
      this._syncLandmark();
    }
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    adoptSheet(root, sheet);
    // Build DOM via createElement — no user content interpolated.
    const leading = document.createElement('slot');
    leading.setAttribute('name', 'leading');

    const titleHost = document.createElement('div');
    titleHost.className = 'title';
    const titleSlot = document.createElement('slot');
    titleHost.appendChild(titleSlot);

    const trailing = document.createElement('slot');
    trailing.setAttribute('name', 'trailing');

    root.append(leading, titleHost, trailing);
  }

  private _syncLandmark(): void {
    const landmark = this.getAttribute('landmark');
    if (landmark === 'none') {
      this.removeAttribute('role');
    } else {
      this.setAttribute('role', 'banner');
    }
  }

  private _scrollHost(): (Window & typeof globalThis) | HTMLElement {
    // Walk ancestors looking for an explicit `data-app-bar-scroll`
    // marker; otherwise fall back to the window. Surfaces that scroll
    // their own container should mark the container with that attr.
    let parent: HTMLElement | null = this.parentElement;
    while (parent) {
      if (parent.hasAttribute('data-app-bar-scroll')) return parent;
      parent = parent.parentElement;
    }
    return window;
  }

  private _readScrollTop(host: (Window & typeof globalThis) | HTMLElement): number {
    if (host === window) {
      return window.scrollY || document.documentElement.scrollTop || 0;
    }
    return (host as HTMLElement).scrollTop;
  }

  private _installScrollListener(): void {
    const behavior = (this.getAttribute('scroll-behavior') ??
      'pin') as AtlasAppBarScrollBehavior;
    if (behavior === 'pin') {
      // Nothing to listen for — sticky CSS does the work.
      this.removeAttribute('data-elevated');
      this.removeAttribute('data-hidden');
      return;
    }
    const host = this._scrollHost();
    this._scrollContainer = host;
    this._lastScrollTop = this._readScrollTop(host);
    const handler = (): void => {
      const top = this._readScrollTop(host);
      if (behavior === 'elevate') {
        if (top > 4) this.setAttribute('data-elevated', '');
        else this.removeAttribute('data-elevated');
      } else if (behavior === 'collapse') {
        const delta = top - this._lastScrollTop;
        // Threshold so micro-jitter doesn't toggle the bar.
        if (top <= 4) {
          this.removeAttribute('data-hidden');
        } else if (delta > 6) {
          this.setAttribute('data-hidden', '');
        } else if (delta < -6) {
          this.removeAttribute('data-hidden');
        }
        this._lastScrollTop = top;
      }
    };
    this._scrollListener = handler;
    host.addEventListener('scroll', handler, { passive: true });
    handler();
  }

  private _removeScrollListener(): void {
    if (this._scrollListener && this._scrollContainer) {
      this._scrollContainer.removeEventListener(
        'scroll',
        this._scrollListener,
      );
    }
    this._scrollListener = null;
    this._scrollContainer = null;
  }
}

AtlasElement.define('atlas-app-bar', AtlasAppBar);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-app-bar': AtlasAppBar;
  }
}
