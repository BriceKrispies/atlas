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
import type { Signal } from '@atlas/core';
import type { WidgetContext } from '@atlas/widget-host';

type TextData = { kind: 'text'; text: string };
type FileData = { kind: 'file'; file: { url?: string; filename?: string } | null };
type AnnouncementData = TextData | FileData | null;

interface AnnouncementsConfig {
  mode?: 'text' | 'file' | string;
  text?: string;
  fileId?: string;
}

export class AnnouncementsWidget extends AtlasSurface {
  static override surfaceId = 'widget.content.announcements';

  /** Skip the base class empty detection — we manage state ourselves. */
  static override empty = null;

  // Widget host injected properties.
  config?: AnnouncementsConfig;
  context?: WidgetContext;
  instanceId?: string;

  private _loadingSig: Signal<boolean>;
  private _errorSig: Signal<string | null>;
  private _dataSig: Signal<AnnouncementData>;
  /** bumps to ignore results from a previous load. */
  private _fetchToken = 0;

  constructor() {
    super();
    this._loadingSig = signal<boolean>(false);
    this._errorSig = signal<string | null>(null);
    this._dataSig = signal<AnnouncementData>(null);
  }

  override async onMount(): Promise<void> {
    const config: AnnouncementsConfig = this.config ?? {};
    const hasMode = config && typeof config === 'object' && 'mode' in config;

    if (!hasMode) {
      this._dataSig.set(null);
      this._errorSig.set(null);
      this._loadingSig.set(false);
      this.setState('empty');
      return;
    }

    if (config.mode === 'text') {
      this._dataSig.set({ kind: 'text', text: String(config.text ?? '') });
      this._errorSig.set(null);
      this._loadingSig.set(false);
      this.setState('success');
      return;
    }

    if (config.mode === 'file') {
      await this._loadFile(config.fileId);
      return;
    }

    // Unknown mode — treat as empty.
    this._dataSig.set(null);
    this._errorSig.set(null);
    this._loadingSig.set(false);
    this.setState('empty');
  }

  override onUnmount(): void {
    // Best-effort: invalidate any in-flight fetch so its resolution
    // is ignored if it arrives after unmount.
    this._fetchToken += 1;
  }

  private async _loadFile(fileId: string | undefined): Promise<void> {
    if (!fileId) {
      this._dataSig.set(null);
      this._errorSig.set(null);
      this._loadingSig.set(false);
      this.setState('empty');
      return;
    }

    const token = ++this._fetchToken;
    this._loadingSig.set(true);
    this._errorSig.set(null);
    this.setState('loading');

    try {
      const result = (await this.context?.request('backend.query', {
        path: `/media/files/${fileId}`,
      })) as { url?: string; filename?: string } | null;
      if (token !== this._fetchToken) return; // superseded / unmounted
      this._dataSig.set({ kind: 'file', file: result ?? null });
      this._loadingSig.set(false);
      this.setState('success');
    } catch (err: unknown) {
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
      this._errorSig.set(message);
      this._dataSig.set(null);
      this._loadingSig.set(false);
      this.setState('error');
    }
  }

  private _retry(): void {
    const config: AnnouncementsConfig = this.config ?? {};
    if (config.mode === 'file') {
      void this._loadFile(config.fileId);
    } else {
      void this.onMount();
    }
  }

  private _dismiss(): void {
    try {
      this.context?.channel?.publish?.('announcement.dismissed', {
        instanceId: this.instanceId,
      });
    } catch (err: unknown) {
      try {
        this.context?.log?.error?.('announcements.dismiss-failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      } catch {
        /* best-effort */
      }
    }
    this._dataSig.set(null);
    this._errorSig.set(null);
    this._loadingSig.set(false);
    this.setState('empty');
  }

  override render(): DocumentFragment {
    if (this._loadingSig.value) {
      return html`
        <atlas-box padding="md">
          <atlas-skeleton name="skeleton" rows="2"></atlas-skeleton>
        </atlas-box>
      `;
    }

    const err = this._errorSig.value;
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

    const data = this._dataSig.value;
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
