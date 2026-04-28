import { AtlasElement } from '@atlas/core';

/**
 * <atlas-toast-provider> — singleton region that renders transient
 * toasts spawned via the imperative API. One provider per app; mount
 * it once at the top of the page.
 *
 *   document.body.appendChild(document.createElement('atlas-toast-provider'));
 *   AtlasToastProvider.show({ tone: 'success', message: 'Saved.' });
 *
 * Light DOM. Container is role=status (aria-live=polite).
 *
 * Each toast is an `<atlas-toast>` child that auto-dismisses after
 * `duration` ms (default 4000). Pass `duration=0` to pin it.
 *
 * Attributes on the provider:
 *   placement — top-end (default) | top-start | top-center |
 *               bottom-end | bottom-start | bottom-center
 *   limit     — max concurrent toasts before oldest evict (default 4)
 */
export interface ToastOptions {
  message: string;
  tone?: 'info' | 'success' | 'warning' | 'danger';
  heading?: string;
  duration?: number;
  action?: { label: string; onClick?: () => void };
}

export class AtlasToastProvider extends AtlasElement {
  private static _instance: AtlasToastProvider | null = null;

  /**
   * Spawn a toast via the shared provider. Idempotently creates a
   * provider on `<body>` if none exists.
   */
  static show(opts: ToastOptions): HTMLElement {
    const provider = AtlasToastProvider._instance ?? AtlasToastProvider._installDefault();
    return provider._push(opts);
  }

  private static _installDefault(): AtlasToastProvider {
    const el = document.createElement('atlas-toast-provider') as AtlasToastProvider;
    document.body.appendChild(el);
    return el;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.setAttribute('role', 'status');
    this.setAttribute('aria-live', 'polite');
    AtlasToastProvider._instance = this;
  }

  override disconnectedCallback(): void {
    if (AtlasToastProvider._instance === this) {
      AtlasToastProvider._instance = null;
    }
    super.disconnectedCallback?.();
  }

  private _push(opts: ToastOptions): HTMLElement {
    const limit = Number(this.getAttribute('limit') ?? '4') || 4;
    const toasts = Array.from(this.querySelectorAll('atlas-toast'));
    while (toasts.length >= limit) {
      toasts.shift()?.remove();
    }

    const toast = document.createElement('atlas-toast') as AtlasToast;
    if (opts.tone) toast.setAttribute('tone', opts.tone);
    if (opts.duration != null) toast.setAttribute('duration', String(opts.duration));
    if (opts.heading) toast.setAttribute('heading', opts.heading);
    toast.textContent = opts.message;
    if (opts.action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('slot', 'action');
      btn.textContent = opts.action.label;
      if (opts.action.onClick) btn.addEventListener('click', opts.action.onClick);
      toast.appendChild(btn);
    }
    this.appendChild(toast);
    return toast;
  }
}

AtlasElement.define('atlas-toast-provider', AtlasToastProvider);

/**
 * <atlas-toast> — single transient notification. Usually spawned via
 * `AtlasToastProvider.show(...)`; can also be declared directly for
 * testing / stories.
 *
 * Auto-dismisses after `duration` ms (default 4000). `duration="0"`
 * pins it; the user must dismiss via the × button.
 *
 * Attributes:
 *   tone       — info | success | warning | danger
 *   heading    — optional first line.
 *   duration   — auto-dismiss ms. `0` disables.
 */
export class AtlasToast extends AtlasElement {
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _built = false;

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._build();
    this._scheduleDismiss();
  }

  override disconnectedCallback(): void {
    if (this._timer) clearTimeout(this._timer);
    super.disconnectedCallback?.();
  }

  dismiss(): void {
    if (this._timer) clearTimeout(this._timer);
    this.remove();
    this.dispatchEvent(new CustomEvent('dismiss', { bubbles: true, composed: true }));
  }

  private _build(): void {
    this.setAttribute('role', 'status');
    // Extract heading attr + slotted action before rebuilding.
    const heading = this.getAttribute('heading');
    const actionNode = this.querySelector(':scope > [slot="action"]');
    const bodyNodes: Node[] = [];
    for (const n of Array.from(this.childNodes)) {
      if (n instanceof Element && n.getAttribute('slot') === 'action') continue;
      bodyNodes.push(n);
    }

    this.innerHTML = '';
    if (heading) {
      const h = document.createElement('atlas-text');
      h.setAttribute('variant', 'medium');
      h.setAttribute('slot', 'heading');
      h.textContent = heading;
      this.appendChild(h);
    }
    const body = document.createElement('span');
    body.setAttribute('data-part', 'body');
    for (const n of bodyNodes) body.appendChild(n);
    this.appendChild(body);

    if (actionNode) this.appendChild(actionNode);

    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('data-part', 'dismiss');
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML =
      '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
    close.addEventListener('click', () => this.dismiss());
    this.appendChild(close);

    this._built = true;
  }

  private _scheduleDismiss(): void {
    const raw = Number(this.getAttribute('duration') ?? '4000');
    if (!Number.isFinite(raw) || raw <= 0) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.dismiss(), raw);
  }
}

AtlasElement.define('atlas-toast', AtlasToast);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-toast-provider': AtlasToastProvider;
    'atlas-toast': AtlasToast;
  }
}
