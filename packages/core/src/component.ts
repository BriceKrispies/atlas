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
import {
  emitTelemetry,
  isDevMode,
  type TelemetryEvent,
} from './telemetry-pipeline.ts';

export type SurfaceState =
  | 'loading'
  | 'empty'
  | 'success'
  | 'error'
  | 'unauthorized';

/** Narrow an arbitrary string to a `SurfaceState` value. */
function asSurfaceState(v: string | null): SurfaceState | null {
  switch (v) {
    case 'loading':
    case 'empty':
    case 'success':
    case 'error':
    case 'unauthorized':
      return v;
    default:
      return null;
  }
}

/**
 * Read the `correlationId` off any object without an `as unknown as` cast.
 * The field is a soft convention: subclasses (page shells, content-page
 * elements) may carry one, but it's not on the base class. We check
 * shape-first to keep the access type-safe.
 */
function readCorrelationId(v: object): string | undefined {
  if (!('correlationId' in v)) return undefined;
  const cid: unknown = (v as { correlationId: unknown }).correlationId;
  return typeof cid === 'string' && cid.length > 0 ? cid : undefined;
}

/** Tags we've already warned about for conflicting re-registration. */
const _defineWarned = new Set<string>();

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
   *
   * Idempotent: if the tag is already registered (e.g. a module was imported
   * twice via differing path aliases), this is a no-op. A one-time warning is
   * logged in dev when the existing registration is a DIFFERENT constructor.
   */
  static define(tag: string, elementClass: CustomElementConstructor): void {
    const existing = customElements.get(tag);
    if (existing) {
      if (existing !== elementClass && !_defineWarned.has(tag)) {
        _defineWarned.add(tag);
        console.warn(
          `[atlas] AtlasElement.define("${tag}"): tag already registered to a different constructor; ignoring re-registration.`,
        );
      }
      return;
    }
    customElements.define(tag, elementClass);
  }

  /**
   * Property descriptor factory for a reflected boolean attribute.
   *
   * Usage (inside a class body):
   *
   *   static {
   *     Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
   *   }
   *
   * Reading returns `hasAttribute(name)`; writing toggles the attribute
   * (presence-only — value is always the empty string when set). Replaces the
   * ~30 repeated `get/set` blocks across the design-system element files.
   */
  static boolAttr(name: string): PropertyDescriptor {
    return {
      configurable: true,
      enumerable: true,
      get(this: HTMLElement): boolean {
        return this.hasAttribute(name);
      },
      set(this: HTMLElement, v: unknown): void {
        if (v) this.setAttribute(name, '');
        else this.removeAttribute(name);
      },
    };
  }

  /**
   * Property descriptor factory for a reflected string attribute with an
   * optional default when the attribute is absent.
   *
   * Usage:
   *
   *   static {
   *     Object.defineProperty(this.prototype, 'type', AtlasElement.strAttr('type', 'text'));
   *   }
   *
   * Reading returns the attribute value, or `defaultValue` when unset. Writing
   * coerces to string and sets the attribute; writing `null`/`undefined`
   * removes it.
   */
  static strAttr(name: string, defaultValue: string = ''): PropertyDescriptor {
    return {
      configurable: true,
      enumerable: true,
      get(this: HTMLElement): string {
        return this.getAttribute(name) ?? defaultValue;
      },
      set(this: HTMLElement, v: unknown): void {
        if (v == null) this.removeAttribute(name);
        else this.setAttribute(name, String(v));
      },
    };
  }

  /**
   * Narrowed access to `this.constructor` as `typeof AtlasElement` (or a
   * subclass). `Function` is the unhelpful default; this protected getter
   * centralises the boundary so the rest of the class can read static
   * fields without scattered casts.
   */
  protected _ctor(): typeof AtlasElement {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: typed-constructor-narrowing
    return this.constructor as typeof AtlasElement;
  }

  connectedCallback(): void {
    this._applyTestId();

    // Set up reactive render if the subclass has a render method
    if (this._ctor().prototype.render !== AtlasElement.prototype.render) {
      this._renderDispose = effect(() => this._safeRender());
    }

    this.onMount();
  }

  /**
   * Run `render()` inside a try/catch. A thrown render no longer silently
   * dies inside the signal `effect` — we emit `Atlas.Render.Failed` and
   * rethrow in dev so Vitest fails loudly. Prod swallows so a single broken
   * element doesn't take down the page.
   */
  protected _safeRender(): void {
    try {
      const content = this.render();
      if (content instanceof DocumentFragment) {
        this.textContent = '';
        this.appendChild(content);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const correlationId = this._effectiveCorrelationId();
      emitTelemetry({
        eventName: 'Atlas.Render.Failed',
        surfaceId: this.surfaceId,
        tagName: this.tagName.toLowerCase(),
        error: { message: error.message, stack: error.stack },
        ...(correlationId ? { correlationId } : {}),
      });
      if (isDevMode()) throw error;
    }
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
      const parent = node.parentElement;
      if (parent) {
        node = parent;
      } else {
        const root = node.getRootNode?.();
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
   * Emit a telemetry event with surface context. Routes through the global
   * telemetry pipeline; default sink is a no-op (dev installs ConsoleJsonSink).
   * Public signature unchanged — 140+ call sites compile as-is.
   */
  emit(eventName: string, properties: Record<string, unknown> = {}): void {
    const cid = this._effectiveCorrelationId();
    const ev: Omit<TelemetryEvent, 'timestamp'> = {
      eventName,
      surfaceId: this.surfaceId,
      ...(cid ? { correlationId: cid } : {}),
      ...properties,
    };
    emitTelemetry(ev);
  }

  /**
   * Walk to the surface for a correlation id when this element doesn't own
   * one. We read `correlationId` off `this` and the surface dynamically so
   * subclasses (page shells, content-page elements) that already declare a
   * `correlationId` field aren't forced into an `override` modifier.
   */
  protected _effectiveCorrelationId(): string | undefined {
    const own = readCorrelationId(this);
    if (own) return own;
    const s = this.surface;
    if (s) {
      const sid = readCorrelationId(s);
      if (sid) return sid;
    }
    return undefined;
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
 * Backend adapter contract used by AtlasSurface for tag-filtered SSE
 * refetch. We define this narrowly here so `@atlas/core` doesn't take a
 * dependency on `@atlas/api-client` (which would create a circular
 * import: api-client already depends on core). The app calls
 * `AtlasSurface.bindBackend(backend)` at boot time to wire the real
 * implementation; if no adapter is bound, surfaces silently no-op
 * subscriptions (so unit tests / non-browser contexts don't blow up).
 */
export interface SurfaceBackendAdapter {
  subscribeTags(
    tags: string[],
    callback: (event: unknown) => void,
  ): () => void;
}

/**
 * AtlasSurface — a top-level surface (page, widget, dialog).
 *
 * Sets the surfaceId context for all child AtlasElements. Surfaces handle
 * data loading automatically — see the original doc block in component.js
 * history for the full lifecycle description.
 *
 * Phase 5 addition: `subscribesTo()` returns the cache-invalidation tags
 * this surface cares about. When non-empty AND a backend adapter has
 * been bound via `AtlasSurface.bindBackend(...)`, the surface opens a
 * tag-filtered SSE subscription on connect and calls `reload()` when a
 * matching event arrives. The subscription is torn down in
 * `disconnectedCallback`.
 */
export class AtlasSurface extends AtlasElement {
  /** Override in subclass */
  static surfaceId = '';

  /** Loading state config. */
  static loading: SurfaceLoadingConfig = { rows: 5 };

  /** Empty state config. Set to null to skip empty detection. */
  static empty: SurfaceEmptyConfig | null = null;

  /**
   * Backend adapter for tag-filtered server-event subscriptions. Wired
   * at app boot via `AtlasSurface.bindBackend(httpBackend)`. Null in
   * non-browser tests and when the app hasn't called bind yet — surfaces
   * no-op rather than throw.
   */
  private static _backend: SurfaceBackendAdapter | null = null;

  static bindBackend(adapter: SurfaceBackendAdapter | null): void {
    AtlasSurface._backend = adapter;
  }

  /** The data returned by load(). Available in render(). */
  data: unknown = null;

  protected _error: string | null = null;
  protected _loading = false;
  /** Unsubscribe handle for the tag-based SSE subscription. */
  private _subscribesToUnsub: (() => void) | null = null;

  /**
   * Narrowed access to `this.constructor` as `typeof AtlasSurface` (or
   * any subclass). Overrides `AtlasElement._ctor` so surface code can
   * read static `surfaceId`, `loading`, and `empty` without scattered
   * casts.
   */
  protected override _ctor(): typeof AtlasSurface {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: typed-constructor-narrowing
    return this.constructor as typeof AtlasSurface;
  }

  /** Whether this surface uses the managed load lifecycle */
  get _managed(): boolean {
    return this._ctor().prototype.load !== AtlasSurface.prototype.load;
  }

  override get surfaceId(): string {
    return this._ctor().surfaceId;
  }

  protected override _applyTestId(): void {
    const sid = this.surfaceId;
    if (sid) {
      this.setAttribute('data-testid', sid);
    }
  }

  /**
   * Track the current state for testing. Emits `Surface.State.<from>.<to>`
   * the first time AND on every actual transition (silent-state findings #2);
   * no-op when the value didn't change.
   */
  setState(state: SurfaceState): void {
    const prev = asSurfaceState(this.getAttribute('data-state'));
    if (prev === state) return;
    this.setAttribute('data-state', state);
    const correlationId = this._effectiveCorrelationId();
    emitTelemetry({
      eventName: `Surface.State.${prev ?? 'init'}.${state}`,
      surfaceId: this.surfaceId,
      from: prev ?? 'init',
      to: state,
      ...(correlationId ? { correlationId } : {}),
    });
  }

  override connectedCallback(): void {
    this._applyTestId();

    if (this._managed) {
      this._showLoading();
      void this._runLoad();
    } else {
      const proto = this._ctor().prototype;
      if (
        proto.render !== AtlasSurface.prototype.render &&
        proto.render !== AtlasElement.prototype.render
      ) {
        this._renderDispose = effect(() => this._safeRender());
      }
    }

    this._wireSubscribesTo();
    this.onMount();
  }

  override disconnectedCallback(): void {
    this.onUnmount();
    if (this._subscribesToUnsub) {
      this._subscribesToUnsub();
      this._subscribesToUnsub = null;
    }
    if (this._renderDispose) {
      this._renderDispose();
      this._renderDispose = null;
    }
  }

  /**
   * Override to declare cache-invalidation tags this surface cares
   * about. When the bound backend delivers an SSE event whose tags
   * overlap this set, `reload()` is called automatically. Default is
   * `[]` (no subscription).
   *
   * Phase 5 limitation: tags are matched by strict equality on the
   * server side — wildcards like `Page:*` are NOT supported yet. Use
   * coarse tags (e.g. `Tenant:<id>`) when you want to refetch on any
   * tenant-scoped change, or enumerate the specific tags you need.
   */
  subscribesTo(): string[] {
    return [];
  }

  protected _wireSubscribesTo(): void {
    const tags = this.subscribesTo();
    if (!tags || tags.length === 0) return;
    const adapter = AtlasSurface._backend;
    if (!adapter) return;
    this._subscribesToUnsub = adapter.subscribeTags(tags, (_event) => {
      // Any matching event triggers a refetch — tag overlap was
      // already filtered server-side. Errors during reload are
      // surfaced via the surface's normal error-state machinery.
      void this.reload();
    });
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

  /**
   * Try to mount the surface frame (call `render()`) and locate the
   * `[data-surface-body]` slot inside it. Returns the slot when the
   * surface opts into the body-slot pattern; null otherwise (legacy
   * full-replacement surfaces).
   *
   * Spec: `specs/decisions/0001-atlas-surface-state-rendering.md`.
   */
  protected _mountFrameAndFindBodySlot(): HTMLElement | null {
    // Tear down any existing reactive render so we don't double-paint.
    if (this._renderDispose) {
      this._renderDispose();
      this._renderDispose = null;
    }
    const frame = this.render();
    if (!(frame instanceof DocumentFragment)) {
      // Surface didn't override render() — there's nothing to mount as
      // a frame. Caller will fall back to legacy full-replacement.
      return null;
    }
    this.textContent = '';
    this.appendChild(frame);
    return this.querySelector<HTMLElement>('[data-surface-body]');
  }

  protected _buildLoadingMarkup(): HTMLElement {
    const cfg = this._ctor().loading;
    const rows = cfg?.rows ?? 5;
    const skeleton = document.createElement('atlas-skeleton');
    skeleton.setAttribute('rows', String(rows));
    skeleton.setAttribute('name', 'skeleton');
    return skeleton;
  }

  protected _buildEmptyMarkup(): HTMLElement {
    const cfg = this._ctor().empty;
    const heading = cfg?.heading ?? 'Nothing here yet';
    const body = cfg?.body ?? '';
    const action = cfg?.action ?? '';

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

    return stack;
  }

  protected _buildErrorMarkup(message: string): HTMLElement {
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
    return wrap;
  }

  protected _showLoading(): void {
    this._loading = true;
    this._error = null;
    this.setState('loading');

    // Loading happens *before* the first successful load — `this.data`
    // is null at that point and most authors' render bodies assume
    // populated data, so we don't try to mount the frame here. The
    // skeleton fully replaces the surface body; the frame appears on
    // the first state transition that has data (success/empty/error).
    this.textContent = '';
    this.appendChild(this._buildLoadingMarkup());
  }

  protected _showError(message: string): void {
    this._error = message;
    this._loading = false;
    this.setState('error');

    // Frame-preservation path (ADR-0001): if the surface declared a
    // `[data-surface-body]` slot, re-mount the frame and overlay the
    // error markup into the slot. Otherwise fall back to legacy
    // full-replacement.
    const slot = this._mountFrameAndFindBodySlot();
    if (slot) {
      slot.textContent = '';
      slot.appendChild(this._buildErrorMarkup(message));
      return;
    }
    this.textContent = '';
    this.appendChild(this._buildErrorMarkup(message));
  }

  protected _showEmpty(): void {
    this._loading = false;
    this.setState('empty');

    // Frame-preservation path (ADR-0001): if the surface includes
    // `[data-surface-body]` in its `render()` output, only the slot's
    // contents get replaced — the page heading / actions stay visible.
    const slot = this._mountFrameAndFindBodySlot();
    if (slot) {
      slot.textContent = '';
      slot.appendChild(this._buildEmptyMarkup());
      return;
    }
    this.textContent = '';
    this.appendChild(this._buildEmptyMarkup());
  }

  protected _showSuccess(): void {
    this._loading = false;
    this.setState('success');

    if (this._renderDispose) {
      this._renderDispose();
      this._renderDispose = null;
    }

    this._renderDispose = effect(() => this._safeRender());
  }

  protected async _runLoad(): Promise<void> {
    try {
      const data = await this.load();
      this.data = data;

      const emptyCfg = this._ctor().empty;
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
