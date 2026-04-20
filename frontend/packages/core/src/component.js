/**
 * AtlasElement — base class for all Atlas custom elements.
 *
 * Extends HTMLElement. Every interactive/testable UI element in Atlas is
 * a custom element that extends this class. It provides:
 *
 * - Automatic data-testid: walks up the DOM to find the nearest AtlasSurface,
 *   combines its surfaceId with this element's `name` attribute.
 * - Telemetry: emit() sends structured events with surface context.
 * - Lifecycle: connectedCallback/disconnectedCallback with onMount/onUnmount hooks.
 * - Reactive rendering: render() returns html`...`, re-renders on signal changes.
 *
 * Custom elements MUST be registered via AtlasElement.define().
 */

import { effect } from './signals.js';

export class AtlasElement extends HTMLElement {
  /** @type {(() => void) | null} */
  _renderDispose = null;

  /**
   * Register this element as a custom element.
   * @param {string} tag — e.g., 'atlas-button'
   * @param {typeof AtlasElement} elementClass
   */
  static define(tag, elementClass) {
    if (!customElements.get(tag)) {
      customElements.define(tag, elementClass);
    }
  }

  connectedCallback() {
    this._applyTestId();

    // Set up reactive render if the subclass has a render method
    if (this.constructor.prototype.render !== AtlasElement.prototype.render) {
      this._renderDispose = effect(() => {
        const content = this.render();
        if (content instanceof DocumentFragment) {
          this.textContent = '';
          this.appendChild(content);
        }
      });
    }

    this.onMount();
  }

  disconnectedCallback() {
    this.onUnmount();
    if (this._renderDispose) {
      this._renderDispose();
      this._renderDispose = null;
    }
  }

  /**
   * Walk up the DOM to find the nearest AtlasSurface ancestor.
   * @returns {AtlasSurface | null}
   */
  get surface() {
    let el = this.parentElement;
    while (el) {
      if (el instanceof AtlasSurface) return el;
      el = el.parentElement;
    }
    return null;
  }

  /**
   * The surfaceId inherited from the nearest AtlasSurface ancestor.
   * @returns {string}
   */
  get surfaceId() {
    return this.surface?.surfaceId ?? '';
  }

  /**
   * Auto-set data-testid from surface context + name attribute.
   * Called on connectedCallback. If no name attribute, no testid is set.
   */
  _applyTestId() {
    const name = this.getAttribute('name');
    if (!name) return;

    const sid = this.surfaceId;
    if (sid) {
      this.setAttribute('data-testid', `${sid}.${name}`);
    }
  }

  /**
   * Render the element's inner content. Override in subclass.
   * @returns {DocumentFragment | void}
   */
  render() {}

  /** Called after the element is connected to the DOM. Override in subclass. */
  onMount() {}

  /** Called when the element is disconnected from the DOM. Override in subclass. */
  onUnmount() {}

  /**
   * Emit a telemetry event with surface context.
   * @param {string} eventName
   * @param {Record<string, unknown>} [properties]
   */
  emit(eventName, properties = {}) {
    console.debug('[telemetry]', {
      eventName,
      surfaceId: this.surfaceId,
      timestamp: new Date().toISOString(),
      ...properties,
    });
  }
}

/**
 * AtlasSurface — a top-level surface (page, widget, dialog).
 *
 * Sets the surfaceId context for all child AtlasElements.
 * Surfaces auto-set their own data-testid from their surfaceId.
 *
 * ## Automatic loading/error/empty states
 *
 * Surfaces handle data loading automatically. The author only writes
 * the success template in render(). Everything else is handled by the
 * base class.
 *
 * Usage:
 *   class PagesListPage extends AtlasSurface {
 *     static surfaceId = 'admin.content.pages-list';
 *
 *     // Optional: configure the automatic states
 *     static loading = { rows: 5 };
 *     static empty = { heading: 'No pages yet', action: 'Create your first page' };
 *
 *     async load() {
 *       // Return the data. Throw on error. Return [] for empty.
 *       return await backend.query('/pages');
 *     }
 *
 *     render() {
 *       // Only called when load() succeeded with non-empty data.
 *       // this.data contains whatever load() returned.
 *       const pages = this.data;
 *       return html`...`;
 *     }
 *   }
 *
 * The surface lifecycle:
 *   1. Element connects → shows loading skeleton automatically
 *   2. load() is called
 *   3a. load() returns data → setState('success'), calls render()
 *   3b. load() returns [] → setState('empty'), shows empty state
 *   3c. load() throws → setState('error'), shows error with retry
 *
 * Surfaces that don't define load() skip straight to render() with
 * no automatic state management (opt-in, not forced).
 */
export class AtlasSurface extends AtlasElement {
  /** @type {string} Override in subclass */
  static surfaceId = '';

  /**
   * Loading state config.
   * @type {{ rows?: number }} */
  static loading = { rows: 5 };

  /**
   * Empty state config. Set to null to skip empty detection.
   * @type {{ heading?: string, body?: string, action?: string } | null}
   */
  static empty = null;

  /** The data returned by load(). Available in render(). */
  data = null;

  /** @type {string | null} */
  _error = null;

  /** @type {boolean} */
  _loading = false;

  /** @type {boolean} Whether this surface uses the managed load lifecycle */
  get _managed() {
    return this.constructor.prototype.load !== AtlasSurface.prototype.load;
  }

  get surfaceId() {
    return /** @type {typeof AtlasSurface} */ (this.constructor).surfaceId;
  }

  _applyTestId() {
    const sid = this.surfaceId;
    if (sid) {
      this.setAttribute('data-testid', sid);
    }
  }

  /**
   * Track the current state for testing.
   * @param {'loading' | 'empty' | 'success' | 'error' | 'unauthorized'} state
   */
  setState(state) {
    this.setAttribute('data-state', state);
  }

  connectedCallback() {
    this._applyTestId();

    if (this._managed) {
      // Managed lifecycle: show loading, then call load()
      this._showLoading();
      this._runLoad();
    } else {
      // Unmanaged: just set up reactive render like AtlasElement
      if (this.constructor.prototype.render !== AtlasSurface.prototype.render &&
          this.constructor.prototype.render !== AtlasElement.prototype.render) {
        this._renderDispose = effect(() => {
          const content = this.render();
          if (content instanceof DocumentFragment) {
            this.textContent = '';
            this.appendChild(content);
          }
        });
      }
    }

    this.onMount();
  }

  disconnectedCallback() {
    this.onUnmount();
    if (this._renderDispose) {
      this._renderDispose();
      this._renderDispose = null;
    }
  }

  /**
   * Override to load data. Return the data. Throw on error.
   * If not overridden, the surface skips managed lifecycle.
   * @returns {Promise<*>}
   */
  async load() {}

  /**
   * Reload data. Call this to refresh (e.g. after a mutation or server event).
   */
  async reload() {
    this._showLoading();
    await this._runLoad();
  }

  /** @private */
  _showLoading() {
    this._loading = true;
    this._error = null;
    this.setState('loading');

    const cfg = /** @type {typeof AtlasSurface} */ (this.constructor).loading;
    const rows = cfg?.rows ?? 5;

    this.textContent = '';
    const skeleton = document.createElement('atlas-skeleton');
    skeleton.setAttribute('rows', String(rows));
    skeleton.setAttribute('name', 'skeleton');
    this.appendChild(skeleton);
  }

  /** @private */
  _showError(message) {
    this._error = message;
    this._loading = false;
    this.setState('error');

    this.textContent = '';
    const wrap = document.createElement('atlas-box');
    wrap.setAttribute('padding', 'lg');

    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'sm');

    const msg = document.createElement('atlas-text');
    msg.setAttribute('variant', 'error');
    msg.textContent = message;
    stack.appendChild(msg);

    const btnWrap = document.createElement('atlas-box');
    const btn = document.createElement('atlas-button');
    btn.setAttribute('name', 'retry-button');
    btn.textContent = 'Retry';
    btn.addEventListener('click', () => this.reload());
    btnWrap.appendChild(btn);
    stack.appendChild(btnWrap);

    wrap.appendChild(stack);
    this.appendChild(wrap);
  }

  /** @private */
  _showEmpty() {
    this._loading = false;
    this.setState('empty');

    const cfg = /** @type {typeof AtlasSurface} */ (this.constructor).empty;
    const heading = cfg?.heading ?? 'Nothing here yet';
    const body = cfg?.body ?? '';
    const action = cfg?.action ?? '';

    this.textContent = '';
    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'md');
    stack.setAttribute('align', 'center');
    stack.setAttribute('padding', 'xl');

    const h = document.createElement('atlas-heading');
    h.setAttribute('level', '2');
    h.textContent = heading;
    stack.appendChild(h);

    if (body) {
      const p = document.createElement('atlas-text');
      p.setAttribute('variant', 'muted');
      p.setAttribute('block', '');
      p.textContent = body;
      stack.appendChild(p);
    }

    if (action) {
      const btn = document.createElement('atlas-button');
      btn.setAttribute('variant', 'primary');
      btn.setAttribute('name', 'empty-action');
      btn.textContent = action;
      btn.addEventListener('click', () => {
        this.dispatchEvent(new CustomEvent('empty-action', { bubbles: true }));
      });
      stack.appendChild(btn);
    }

    this.appendChild(stack);
  }

  /** @private */
  _showSuccess() {
    this._loading = false;
    this.setState('success');

    // Dispose previous reactive render
    if (this._renderDispose) {
      this._renderDispose();
      this._renderDispose = null;
    }

    // Set up reactive render
    this._renderDispose = effect(() => {
      const content = this.render();
      if (content instanceof DocumentFragment) {
        this.textContent = '';
        this.appendChild(content);
      }
    });
  }

  /** @private */
  async _runLoad() {
    try {
      const data = await this.load();
      this.data = data;

      // Check for empty
      const emptyCfg = /** @type {typeof AtlasSurface} */ (this.constructor).empty;
      const isEmpty = emptyCfg && (
        data == null ||
        (Array.isArray(data) && data.length === 0)
      );

      if (isEmpty) {
        this._showEmpty();
      } else {
        this._showSuccess();
      }
    } catch (e) {
      this._showError(e?.message ?? 'Something went wrong');
    }
  }
}
