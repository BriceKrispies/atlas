/**
 * PolicyDiffDialog — modal showing a <atlas-diff> between two policy
 * versions' raw Cedar text. Mounted by the shell on the
 * `authz-open-diff` custom event.
 */

import { AtlasSurface, html } from '@atlas/core';
import { getPolicy, listPolicies, type PolicySummary } from '@atlas/api-client';
import '@atlas/design';

interface DiffState {
  open: boolean;
  versions: readonly PolicySummary[];
  leftVersion: number | null;
  rightVersion: number | null;
  leftText: string;
  rightText: string;
  loading: boolean;
  loadError: string | null;
}

class PolicyDiffDialog extends AtlasSurface {
  static override surfaceId = 'admin.authz.policy-diff';

  private _state: DiffState = {
    open: false,
    versions: [],
    leftVersion: null,
    rightVersion: null,
    leftText: '',
    rightText: '',
    loading: false,
    loadError: null,
  };

  override async load(): Promise<DiffState> {
    return this._state;
  }

  /** Imperative re-render. See `PolicyEditorPage._rerender` for rationale. */
  private _rerender(): void {
    const fragment = this.render();
    this.textContent = '';
    this.appendChild(fragment);
  }

  override onMount(): void {
    document.addEventListener('authz-open-diff', this._onOpen as EventListener);
  }

  override onUnmount(): void {
    document.removeEventListener('authz-open-diff', this._onOpen as EventListener);
  }

  private _onOpen = (e: Event): void => {
    const detail = (e as CustomEvent<{ rightVersion?: number }>).detail ?? {};
    void this._open(detail.rightVersion ?? null);
  };

  private async _open(rightVersion: number | null): Promise<void> {
    this._state = { ...this._state, open: true, loading: true, loadError: null };
    this._rerender();
    try {
      const versions = await listPolicies();
      // Pick a sensible default for "left" — the active version, falling
      // back to the next-newest entry that isn't the right one.
      const active = versions.find((v) => v.status === 'active');
      const leftVersion =
        rightVersion !== null && active && active.version !== rightVersion
          ? active.version
          : versions.find((v) => v.version !== rightVersion)?.version ?? null;
      const [leftDetail, rightDetail] = await Promise.all([
        leftVersion !== null ? getPolicy(leftVersion) : Promise.resolve(null),
        rightVersion !== null ? getPolicy(rightVersion) : Promise.resolve(null),
      ]);
      this._state = {
        ...this._state,
        versions,
        leftVersion,
        rightVersion,
        leftText: leftDetail?.cedarText ?? '',
        rightText: rightDetail?.cedarText ?? '',
        loading: false,
      };
      this.emit('admin.authz.policy-diff.opened', {
        leftVersion: String(leftVersion),
        rightVersion: String(rightVersion),
      });
    } catch (e) {
      this._state = {
        ...this._state,
        loading: false,
        loadError: (e as Error).message,
      };
    }
    this._rerender();
  }

  private _close = (): void => {
    this._state = { ...this._state, open: false };
    this._rerender();
    this.emit('admin.authz.policy-diff.closed');
  };

  override render(): DocumentFragment {
    if (!this._state.open) return html``;
    const s = this._state;
    return html`
      <atlas-dialog
        name="dialog"
        open
        heading="Compare policy versions"
        @close=${this._close}
      >
        <atlas-stack gap="md">
          <atlas-stack direction="row" gap="md">
            ${this._renderPicker('left-version', 'Left', s.leftVersion, (v) => {
              void this._setSide('left', v);
            })}
            ${this._renderPicker('right-version', 'Right', s.rightVersion, (v) => {
              void this._setSide('right', v);
            })}
          </atlas-stack>
          ${s.loadError !== null
            ? html`<atlas-alert variant="error">${s.loadError}</atlas-alert>`
            : ''}
          ${this._renderDiff()}
          <atlas-stack direction="row" justify="flex-end">
            <atlas-button name="close-button" variant="secondary" @click=${this._close}>
              Close
            </atlas-button>
          </atlas-stack>
        </atlas-stack>
      </atlas-dialog>
    `;
  }

  private _renderDiff(): HTMLElement {
    const diff = document.createElement('atlas-diff');
    diff.setAttribute('name', 'diff');
    (diff as unknown as { left: string; right: string }).left = this._state.leftText;
    (diff as unknown as { left: string; right: string }).right = this._state.rightText;
    return diff;
  }

  private _renderPicker(
    name: string,
    label: string,
    value: number | null,
    onChange: (v: number) => void,
  ): HTMLElement {
    const input = document.createElement('atlas-input');
    input.setAttribute('name', name);
    input.setAttribute('label', label);
    input.setAttribute('type', 'number');
    if (value !== null) input.setAttribute('value', String(value));
    input.addEventListener('change', (e: Event) => {
      const v = (e.target as unknown as { value?: string } | null)?.value;
      const n = v !== undefined ? Number(v) : NaN;
      if (Number.isFinite(n)) onChange(n);
    });
    return input;
  }

  private async _setSide(side: 'left' | 'right', version: number): Promise<void> {
    try {
      const detail = await getPolicy(version);
      const text = detail?.cedarText ?? '';
      if (side === 'left') {
        this._state = { ...this._state, leftVersion: version, leftText: text };
      } else {
        this._state = { ...this._state, rightVersion: version, rightText: text };
      }
      this._rerender();
    } catch (e) {
      this._state = { ...this._state, loadError: (e as Error).message };
      this._rerender();
    }
  }
}

AtlasSurface.define('policy-diff-dialog', PolicyDiffDialog);
