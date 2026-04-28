/**
 * <page-editor-preview> — dedicated preview surface for the page editor (S5).
 *
 * The shell currently renders preview by setting `<content-page edit=false>`
 * on its canvas content-page. This element replaces that inline rendering
 * with a self-contained surface that wraps the page in a chosen device
 * frame (mobile / tablet / desktop), and exposes a device-tab switcher and
 * an exit affordance.
 *
 * Shadow vs. light DOM: the preview uses a shadow root. It is NOT a panel
 * (panels are light DOM so the shell can inject `<div data-tab>` slots) —
 * the preview is mounted directly on the canvas-stage, and the device frame
 * benefits from style isolation (rounded bezel, fixed-width inner viewport,
 * adopted templates CSS so the inner `<content-page>` renders correctly).
 *
 * The shell delegates two intents to the controller from the preview UI:
 *   - `setDevice` (commits on `editor:<pageId>:shell`, intent
 *     `deviceChange` with `patch.device`)
 *   - `setMode('content')` (commits on `editor:<pageId>:shell`, intent
 *     `setMode` with `patch.mode === 'content'`) — fired by the
 *     "Exit preview" button.
 *
 * The preview surface ALSO commits its own `breakpointSet` on
 * `editor:<pageId>:preview` so tests can assert at the preview boundary
 * without going through the shell. Today the shell-level `setDevice`
 * implies the preview's breakpoint (1:1); this surface still commits a
 * `breakpointSet` envelope alongside the shell's `deviceChange` so future
 * custom-px breakpoints have a stable assertion point.
 */

import { AtlasElement, AtlasSurface } from '@atlas/core';
import { adoptAtlasStyles } from '@atlas/design/shared-styles';
import { adoptAtlasWidgetStyles } from '@atlas/widgets/shared-styles';
import { registerTestState, makeCommit, type CommitRecord } from '@atlas/test-state';
import templatesCssText from '@atlas/bundle-standard/templates/templates.css?inline';
import type {
  EditorAPI,
  PageDocument,
  PageStore,
} from '@atlas/page-templates';
import type {
  PageEditorController,
  PageEditorStateSnapshot,
  PreviewDevice,
} from '../state.ts';
import type { WrappedPageStore } from '../history.ts';
import { DEVICES, deviceFrame, type DeviceFrame } from './devices.ts';

interface ContentPageElement extends HTMLElement {
  pageId?: string;
  pageStore?: PageStore | WrappedPageStore | null;
  layoutRegistry?: unknown;
  templateRegistry?: unknown;
  principal?: unknown;
  tenantId?: string;
  correlationId?: string;
  capabilities?: Record<string, (args: unknown) => Promise<unknown>>;
  edit?: boolean;
  editor?: EditorAPI | null;
  reload?: () => Promise<void>;
  _currentDoc?: PageDocument | null;
}

interface PreviewTestSnapshot {
  device: PreviewDevice;
  frameWidth: number;
  frameHeight: number;
  contentPageReady: boolean;
  lastCommit: CommitRecord | null;
}

const styles = `
  :host {
    display: block;
    width: 100%;
    height: 100%;
    background: var(--atlas-color-bg-muted, #f1f5f9);
    color: var(--atlas-color-text);
    font-family: var(--atlas-font-family);
  }

  atlas-box[data-role="toolbar"] {
    display: flex;
    align-items: center;
    gap: var(--atlas-space-sm);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    background: var(--atlas-color-surface);
    border-bottom: 1px solid var(--atlas-color-border);
    min-height: 48px;
  }

  atlas-box[data-role="toolbar"] atlas-box[data-role="spacer"] {
    flex: 1;
  }

  atlas-segmented-control[name="device"] {
    /* segmented control already enforces 44px touch target on segments */
  }

  /* Center the device frame inside a scrollable stage. */
  atlas-box[data-role="stage"] {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    overflow: auto;
    padding: var(--atlas-space-lg);
    min-height: 0;
    background:
      linear-gradient(45deg, rgba(0,0,0,0.02) 25%, transparent 25%) 0 0/16px 16px,
      linear-gradient(-45deg, rgba(0,0,0,0.02) 25%, transparent 25%) 0 8px/16px 16px,
      var(--atlas-color-bg-muted, #f1f5f9);
  }

  /* The device frame wraps the inner content-page at the chosen breakpoint. */
  atlas-box[data-role="frame"] {
    display: block;
    background: var(--atlas-color-bg);
    border: 1px solid var(--atlas-color-border-strong, #94a3b8);
    border-radius: var(--atlas-radius-lg, 12px);
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
    overflow: hidden;
    /* width and height are set inline from the active device. */
  }

  atlas-box[data-role="frame"] content-page {
    display: block;
    width: 100%;
    min-height: 100%;
  }

  atlas-stack[name="empty-hint"] {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    text-align: center;
    padding: var(--atlas-space-lg);
  }

  atlas-button[disabled] { opacity: 0.5; pointer-events: none; }

  /* Mobile-first override (≤768px): the toolbar wraps and the stage uses
     less padding so the frame remains visible at small viewports. */
  @media (max-width: 768px) {
    atlas-box[data-role="toolbar"] {
      flex-wrap: wrap;
    }
    atlas-box[data-role="stage"] {
      padding: var(--atlas-space-sm);
    }
  }
`;

export class PageEditorPreviewElement extends AtlasSurface {
  static override surfaceId = 'authoring.page-editor.preview';

  // Mirror of the shell's `<content-page>` prop bag. The shell sets these
  // before mounting the preview so they propagate to the inner page render.
  pageId = '';
  templateRegistry: unknown = null;
  layoutRegistry: unknown = null;
  principal: unknown = null;
  tenantId = '';
  correlationId = '';
  capabilities: Record<string, (args: unknown) => Promise<unknown>> = {};

  private _controller: PageEditorController | null = null;
  private _unsubscribe: (() => void) | null = null;
  private _disposeTestState: (() => void) | null = null;
  private _contentPage: ContentPageElement | null = null;
  private _frameEl: HTMLElement | null = null;
  private _stageEl: HTMLElement | null = null;
  private _segmented: (HTMLElement & { options?: unknown; value?: string | null }) | null = null;
  private _readout: HTMLElement | null = null;
  private _lastSnapshot: PageEditorStateSnapshot | null = null;
  private _lastCommit: CommitRecord | null = null;
  private _emptyHint: HTMLElement | null = null;

  // Surface-local key for the @atlas/test-state reader.
  private get _testStateKey(): string {
    return `editor:${this.pageId}:preview`;
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    adoptAtlasStyles(this.shadowRoot as unknown as ShadowRoot);
    adoptAtlasWidgetStyles(this.shadowRoot as unknown as ShadowRoot);
  }

  /** Setter so the shell can inject the controller imperatively. */
  set controller(next: PageEditorController | null) {
    if (this._controller === next) return;
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._controller = next;
    if (this._controller && this.isConnected) {
      this._unsubscribe = this._controller.subscribe((snap) => this._onSnapshot(snap));
      // Fire an initial render with the current snapshot.
      this._onSnapshot(this._controller.getSnapshot());
    }
  }
  get controller(): PageEditorController | null {
    return this._controller;
  }

  override connectedCallback(): void {
    super.connectedCallback?.();
    this._applyTestId?.();
    this._renderShell();
    this._installTestState();
    if (this._controller && !this._unsubscribe) {
      this._unsubscribe = this._controller.subscribe((snap) => this._onSnapshot(snap));
      this._onSnapshot(this._controller.getSnapshot());
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback?.();
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._disposeTestState?.();
    this._disposeTestState = null;
    this._contentPage = null;
    this._frameEl = null;
    this._stageEl = null;
    this._segmented = null;
    this._readout = null;
    this._emptyHint = null;
    this._lastSnapshot = null;
  }

  /** Test-only accessor for the device currently rendered. */
  getCurrentDevice(): PreviewDevice {
    return this._controller?.getSnapshot().device ?? 'desktop';
  }

  // ---- internals ----

  private _installTestState(): void {
    if (!this.pageId) return;
    this._disposeTestState?.();
    this._disposeTestState = registerTestState(this._testStateKey, () =>
      this._buildTestSnapshot(),
    );
  }

  private _buildTestSnapshot(): PreviewTestSnapshot {
    const device = this._controller?.getSnapshot().device ?? 'desktop';
    const frame = deviceFrame(device);
    return {
      device,
      frameWidth: frame.width,
      frameHeight: frame.height,
      contentPageReady: !!this._contentPage,
      lastCommit: this._lastCommit,
    };
  }

  private _renderShell(): void {
    const root = this.shadowRoot as ShadowRoot;
    root.innerHTML = `
      <style>${styles}\n${templatesCssText}</style>
      <atlas-box data-role="toolbar" name="toolbar">
        <atlas-segmented-control name="device" aria-label="Preview device" size="sm"></atlas-segmented-control>
        <atlas-text variant="small" name="frame-width-readout"></atlas-text>
        <atlas-box data-role="spacer"></atlas-box>
        <!-- S5+ wiring: open in new tab is disabled until a public preview URL exists. -->
        <atlas-button name="open-in-new-tab" variant="ghost" size="sm" disabled aria-label="Open in new tab">Open in new tab</atlas-button>
        <!-- Exit-preview lives in the shell topbar; duplicating it here just
             produces two buttons with the same intent. -->
      </atlas-box>
      <atlas-box data-role="stage">
        <atlas-box data-role="frame" name="frame"></atlas-box>
      </atlas-box>
    `;

    const segmented = root.querySelector('atlas-segmented-control[name="device"]') as
      (HTMLElement & { options: unknown; value: string | null }) | null;
    if (segmented) {
      segmented.options = DEVICES.map((d) => ({ value: d.id, label: d.label }));
      segmented.value = this._controller?.getSnapshot().device ?? 'desktop';
      segmented.addEventListener('change', (ev) => {
        const value = (ev as CustomEvent<{ value: string }>).detail?.value;
        if (!value) return;
        this._handleDeviceChange(value as PreviewDevice);
      });
    }
    this._segmented = segmented;
    this._readout = root.querySelector('atlas-text[name="frame-width-readout"]') as HTMLElement | null;
    this._frameEl = root.querySelector('atlas-box[data-role="frame"]') as HTMLElement | null;
    this._stageEl = root.querySelector('atlas-box[data-role="stage"]') as HTMLElement | null;

    // Mount the inner content-page once.
    this._mountContentPage();
    this._reflectFrame(this._controller?.getSnapshot().device ?? 'desktop');
  }

  private _mountContentPage(): void {
    if (!this._frameEl || !this._controller) return;
    this._frameEl.textContent = '';
    const page = document.createElement('content-page') as ContentPageElement;
    page.pageId = this.pageId;
    page.pageStore = this._controller.wrappedStore;
    if (this.layoutRegistry) page.layoutRegistry = this.layoutRegistry;
    if (this.templateRegistry) page.templateRegistry = this.templateRegistry;
    page.principal = this.principal;
    page.tenantId = this.tenantId;
    page.correlationId = this.correlationId;
    page.capabilities = this.capabilities ?? {};
    // Preview is read-only.
    page.edit = false;
    this._frameEl.appendChild(page);
    this._contentPage = page;
  }

  private _onSnapshot(snap: PageEditorStateSnapshot): void {
    const prev = this._lastSnapshot;
    this._lastSnapshot = snap;

    if (!prev || prev.device !== snap.device) {
      this._reflectFrame(snap.device);
      if (this._segmented && this._segmented.value !== snap.device) {
        this._segmented.value = snap.device;
      }
    }

    if (!prev || prev.widgetInstances.length !== snap.widgetInstances.length) {
      this._reflectEmptyState(snap.widgetInstances.length === 0);
    }
  }

  private _reflectFrame(device: PreviewDevice): void {
    const frame = deviceFrame(device);
    if (this._frameEl) {
      this._frameEl.style.width = `${frame.width}px`;
      this._frameEl.style.height = `${frame.height}px`;
    }
    if (this._readout) {
      this._readout.textContent = `${frame.width} × ${frame.height}`;
    }
    this.setAttribute('data-device', device);
  }

  private _reflectEmptyState(isEmpty: boolean): void {
    if (!this._frameEl) return;
    // Keep the content-page mounted in either state (the page's own empty
    // visual is respected). We add a sibling hint stack so the contract's
    // `empty-hint` element exists when the document has no widgets.
    if (isEmpty) {
      if (!this._emptyHint) {
        const hint = document.createElement('atlas-stack');
        hint.setAttribute('name', 'empty-hint');
        hint.setAttribute('gap', 'sm');
        const heading = document.createElement('atlas-heading');
        heading.setAttribute('level', '4');
        heading.textContent = 'Nothing to preview yet';
        const text = document.createElement('atlas-text');
        text.setAttribute('variant', 'muted');
        text.textContent = 'Add widgets in content mode and they will appear here.';
        hint.appendChild(heading);
        hint.appendChild(text);
        this._frameEl.appendChild(hint);
        this._emptyHint = hint;
      }
    } else if (this._emptyHint) {
      this._emptyHint.remove();
      this._emptyHint = null;
    }
  }

  private _handleDeviceChange(nextDevice: PreviewDevice): void {
    if (!this._controller) return;
    const snap = this._controller.getSnapshot();
    if (snap.device === nextDevice) return;
    const previousFrame = deviceFrame(snap.device);
    const nextFrame = deviceFrame(nextDevice);
    // 1) Shell-level deviceChange commit lands via the controller.
    this._controller.setDevice(nextDevice);
    // 2) Preview-local breakpointSet commit so callers can assert at the
    //    preview boundary. Today these are 1:1 with the device defaults; a
    //    future revision will let users scrub a breakpoint slider and emit
    //    additional `breakpointSet` envelopes between device picks.
    this._recordCommit('breakpointSet', {
      device: nextDevice,
      width: nextFrame.width,
      height: nextFrame.height,
      previousDevice: snap.device,
      previousWidth: previousFrame.width,
    });
  }

  private _recordCommit(intent: string, patch: Record<string, unknown>): void {
    this._lastCommit = makeCommit(this.surfaceId, intent, patch);
  }
}

AtlasElement.define('page-editor-preview', PageEditorPreviewElement);
