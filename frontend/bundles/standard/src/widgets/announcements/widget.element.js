/**
 * AnnouncementsWidget — the first real Atlas widget.
 *
 * Extends AtlasSurface in unmanaged mode: the widget drives its own
 * state transitions (`loading`, `empty`, `success`, `error`) via
 * setState() plus a trio of signals, rather than using the surface's
 * built-in load() lifecycle. That's because a text-mode announcement
 * has nothing to load — skipping straight to `success` without
 * flashing a skeleton requires manual control.
 *
 * Frontend constitution:
 *   - C11: render() uses only atlas-* custom elements, with a single
 *     pragmatic `<img>` exception for media display (marked inline).
 *   - C4: loading / empty / success / error states are all implemented;
 *     validationError and unauthorized are declared as deferred in the
 *     manifest.
 */

import { AtlasSurface, html, signal } from '@atlas/core';

export class AnnouncementsWidget extends AtlasSurface {
  static surfaceId = 'widget.content.announcements';

  /** Skip the base class empty detection — we manage state ourselves. */
  static empty = null;

  constructor() {
    super();
    this._loading = signal(false);
    this._error = signal(null);
    this._data = signal(null);
    /** @type {number} bumps to ignore results from a previous load. */
    this._fetchToken = 0;
  }

  async onMount() {
    const config = this.config ?? {};
    const hasMode = config && typeof config === 'object' && 'mode' in config;

    if (!hasMode) {
      this._data.set(null);
      this._error.set(null);
      this._loading.set(false);
      this.setState('empty');
      return;
    }

    if (config.mode === 'text') {
      this._data.set({ kind: 'text', text: String(config.text ?? '') });
      this._error.set(null);
      this._loading.set(false);
      this.setState('success');
      return;
    }

    if (config.mode === 'file') {
      await this._loadFile(config.fileId);
      return;
    }

    // Unknown mode — treat as empty.
    this._data.set(null);
    this._error.set(null);
    this._loading.set(false);
    this.setState('empty');
  }

  onUnmount() {
    // Best-effort: invalidate any in-flight fetch so its resolution
    // is ignored if it arrives after unmount.
    this._fetchToken += 1;
  }

  async _loadFile(fileId) {
    if (!fileId) {
      this._data.set(null);
      this._error.set(null);
      this._loading.set(false);
      this.setState('empty');
      return;
    }

    const token = ++this._fetchToken;
    this._loading.set(true);
    this._error.set(null);
    this.setState('loading');

    try {
      const result = await this.context.request('backend.query', {
        path: `/media/files/${fileId}`,
      });
      if (token !== this._fetchToken) return; // superseded / unmounted
      this._data.set({ kind: 'file', file: result });
      this._loading.set(false);
      this.setState('success');
    } catch (err) {
      if (token !== this._fetchToken) return;
      const message = err instanceof Error ? err.message : String(err);
      try {
        this.context?.log?.error?.('announcements.load-failed', {
          fileId,
          message,
        });
      } catch {
        /* logging is best-effort */
      }
      this._error.set(message);
      this._data.set(null);
      this._loading.set(false);
      this.setState('error');
    }
  }

  _retry() {
    const config = this.config ?? {};
    if (config.mode === 'file') {
      void this._loadFile(config.fileId);
    } else {
      void this.onMount();
    }
  }

  _dismiss() {
    try {
      this.context?.channel?.publish?.('announcement.dismissed', {
        instanceId: this.instanceId,
      });
    } catch (err) {
      try {
        this.context?.log?.error?.('announcements.dismiss-failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      } catch {
        /* best-effort */
      }
    }
    this._data.set(null);
    this._error.set(null);
    this._loading.set(false);
    this.setState('empty');
  }

  render() {
    if (this._loading.value) {
      return html`
        <atlas-box padding="md">
          <atlas-skeleton name="skeleton" rows="2"></atlas-skeleton>
        </atlas-box>
      `;
    }

    const err = this._error.value;
    if (err) {
      return html`
        <atlas-box padding="md">
          <atlas-stack gap="sm">
            <atlas-text name="error" variant="error">${err}</atlas-text>
            <atlas-box>
              <atlas-button name="retry-button" @click=${() => this._retry()}>
                Retry
              </atlas-button>
            </atlas-box>
          </atlas-stack>
        </atlas-box>
      `;
    }

    const data = this._data.value;
    if (!data) {
      return html`
        <atlas-box padding="md">
          <atlas-text name="empty" variant="muted">No announcement configured.</atlas-text>
        </atlas-box>
      `;
    }

    if (data.kind === 'text') {
      return html`
        <atlas-box padding="md">
          <atlas-stack gap="sm">
            <atlas-heading level="2">Announcement</atlas-heading>
            <atlas-text name="body">${data.text}</atlas-text>
            <atlas-box>
              <atlas-button name="dismiss-button" @click=${() => this._dismiss()}>
                Dismiss
              </atlas-button>
            </atlas-box>
          </atlas-stack>
        </atlas-box>
      `;
    }

    // file mode: render heading + inline media. <img> is an acknowledged
    // pragmatic exception to C11 for media display; the rest of the tree
    // sticks to atlas-* elements.
    const file = data.file ?? {};
    const url = file.url ?? '';
    const alt = file.filename ?? 'Announcement media';
    return html`
      <atlas-box padding="md">
        <atlas-stack gap="sm">
          <atlas-heading level="2">Announcement</atlas-heading>
          <atlas-box>
            ${url
              ? html`<img src="${url}" alt="${alt}" style="max-width:100%;height:auto;" />`
              : html`<atlas-text name="media-missing" variant="muted">Media unavailable.</atlas-text>`}
          </atlas-box>
          <atlas-box>
            <atlas-button name="dismiss-button" @click=${() => this._dismiss()}>
              Dismiss
            </atlas-button>
          </atlas-box>
        </atlas-stack>
      </atlas-box>
    `;
  }
}

AtlasSurface.define('widget-announcements', AnnouncementsWidget);
