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

import { effect, type EffectCleanup } from './signals.ts';

export type SurfaceState =
  | 'loading'
  | 'empty'
  | 'success'
  | 'error'
  | 'unauthorized';

export class AtlasElement extends HTMLElement {
  protected _renderDispose: EffectCleanup | null = null;

  /**
   * Attributes whose changes should trigger attributeChangedCallback.
   * Override as a static getter in subclasses.
   */
  static get observedAttributes(): readonly string[] {
    return [];
  }

  /**
   * Called when an observed attribute changes. Override in subclass.
   */
  attributeChangedCallback(
    _name: string,
    _oldValue: string | null,
    _newValue: string | null,
  ): void {}

  /**
   * Register this element as a custom element.
   */
  static define(tag: string, elementClass: CustomElementConstructor): void {
    if (!customElements.get(tag)) {
      customElements.define(tag, elementClass);
    }
  }

  connectedCallback(): void {
    this._applyTestId();

    // Set up reactive render if the subclass has a render method
    if (
      (this.constructor as typeof AtlasElement).prototype.render !==
      AtlasElement.prototype.render
    ) {
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

  disconnectedCallback(): void {
    this.onUnmount();
    if (this._renderDispose) {
      this._renderDispose();
      this._renderDispose = null;
    }
  }

  /**
   * Walk up the DOM to find the nearest AtlasSurface ancestor,
   * crossing shadow-root boundaries via the host.
   */
  get surface(): AtlasSurface | null {
    let node: (Node & ParentNode) | null = this.parentElement;
    if (!node) {
      const root = this.getRootNode?.();
      node = root instanceof ShadowRoot ? root.host : null;
    }
    while (node) {
      if (node instanceof AtlasSurface) return node;
      const parent = (node as Element).parentElement;
      if (parent) {
        node = parent;
      } else {
        const root = (node as Node).getRootNode?.();
        node = root instanceof ShadowRoot ? root.host : null;
      }
    }
    return null;
  }

  /**
   * The surfaceId inherited from the nearest AtlasSurface ancestor.
   */
  get surfaceId(): string {
    return this.surface?.surfaceId ?? '';
  }

  /**
   * Auto-set data-testid from surface context + name attribute.
   * Called on connectedCallback. If no name attribute, no testid is set.
   *
   * If the element also has a `key` attribute, it is appended to the
   * testid — producing `{surfaceId}.{name}.{key}`.
   */
  protected _applyTestId(): void {
    const name = this.getAttribute('name');
    if (!name) return;

    const sid = this.surfaceId;
    if (!sid) return;

    const key = this.getAttribute('key');
    const testId = key ? `${sid}.${name}.${key}` : `${sid}.${name}`;
    this.setAttribute('data-testid', testId);
  }

  /**
   * Render the element's inner content. Override in subclass.
   */
  render(): DocumentFragment | void {
    return;
  }

  /** Called after the element is connected to the DOM. Override in subclass. */
  onMount(): void {}

  /** Called when the element is disconnected from the DOM. Override in subclass. */
  onUnmount(): void {}

  /**
   * Emit a telemetry event with surface context.
   */
  emit(eventName: string, properties: Record<string, unknown> = {}): void {
    console.debug('[telemetry]', {
      eventName,
      surfaceId: this.surfaceId,
      timestamp: new Date().toISOString(),
      ...properties,
    });
  }
}

export interface SurfaceLoadingConfig {
  rows?: number;
}

export interface SurfaceEmptyConfig {
  heading?: string;
  body?: string;
  action?: string;
}

/**
 * AtlasSurface — a top-level surface (page, widget, dialog).
 *
 * Sets the surfaceId context for all child AtlasElements. Surfaces handle
 * data loading automatically — see the original doc block in component.js
 * history for the full lifecycle description.
 */
export class AtlasSurface extends AtlasElement {
  /** Override in subclass */
  static surfaceId = '';

  /** Loading state config. */
  static loading: SurfaceLoadingConfig = { rows: 5 };

  /** Empty state config. Set to null to skip empty detection. */
  static empty: SurfaceEmptyConfig | null = null;

  /** The data returned by load(). Available in render(). */
  data: unknown = null;

  protected _error: string | null = null;
  protected _loading = false;

  /** Whether this surface uses the managed load lifecycle */
  get _managed(): boolean {
    return (
      (this.constructor as typeof AtlasSurface).prototype.load !==
      AtlasSurface.prototype.load
    );
  }

  override get surfaceId(): string {
    return (this.constructor as typeof AtlasSurface).surfaceId;
  }

  protected override _applyTestId(): void {
    const sid = this.surfaceId;
    if (sid) {
      this.setAttribute('data-testid', sid);
    }
  }

  /** Track the current state for testing. */
  setState(state: SurfaceState): void {
    this.setAttribute('data-state', state);
  }

  override connectedCallback(): void {
    this._applyTestId();

    if (this._managed) {
      this._showLoading();
      void this._runLoad();
    } else {
      const proto = (this.constructor as typeof AtlasSurface).prototype;
      if (
        proto.render !== AtlasSurface.prototype.render &&
        proto.render !== AtlasElement.prototype.render
      ) {
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

  override disconnectedCallback(): void {
    this.onUnmount();
    if (this._renderDispose) {
      this._renderDispose();
      this._renderDispose = null;
    }
  }

  /**
   * Override to load data. Return the data. Throw on error.
   * If not overridden, the surface skips managed lifecycle.
   */
  async load(): Promise<unknown> {
    return undefined;
  }

  /**
   * Reload data. Call this to refresh (e.g. after a mutation or server event).
   */
  async reload(): Promise<void> {
    this._showLoading();
    await this._runLoad();
  }

  protected _showLoading(): void {
    this._loading = true;
    this._error = null;
    this.setState('loading');

    const cfg = (this.constructor as typeof AtlasSurface).loading;
    const rows = cfg?.rows ?? 5;

    this.textContent = '';
    const skeleton = document.createElement('atlas-skeleton');
    skeleton.setAttribute('rows', String(rows));
    skeleton.setAttribute('name', 'skeleton');
    this.appendChild(skeleton);
  }

  protected _showError(message: string): void {
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
    btn.addEventListener('click', () => void this.reload());
    btnWrap.appendChild(btn);
    stack.appendChild(btnWrap);

    wrap.appendChild(stack);
    this.appendChild(wrap);
  }

  protected _showEmpty(): void {
    this._loading = false;
    this.setState('empty');

    const cfg = (this.constructor as typeof AtlasSurface).empty;
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

  protected _showSuccess(): void {
    this._loading = false;
    this.setState('success');

    if (this._renderDispose) {
      this._renderDispose();
      this._renderDispose = null;
    }

    this._renderDispose = effect(() => {
      const content = this.render();
      if (content instanceof DocumentFragment) {
        this.textContent = '';
        this.appendChild(content);
      }
    });
  }

  protected async _runLoad(): Promise<void> {
    try {
      const data = await this.load();
      this.data = data;

      const emptyCfg = (this.constructor as typeof AtlasSurface).empty;
      const isEmpty =
        emptyCfg &&
        (data == null || (Array.isArray(data) && data.length === 0));

      if (isEmpty) {
        this._showEmpty();
      } else {
        this._showSuccess();
      }
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Something went wrong';
      this._showError(message);
    }
  }
}
