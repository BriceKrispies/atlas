import { AtlasSurface, html } from '@atlas/core';
import {
  listPolicies,
  activatePolicy,
  archivePolicy,
  type PolicySummary,
} from '@atlas/api-client';
import { registerTestState } from '@atlas/test-state';
import '@atlas/design';

interface ProjectionUpdatedEvent {
  resourceType?: string;
}

/** Extract the message string from an unknown thrown value. */
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

class PoliciesListPage extends AtlasSurface {
  static override surfaceId = 'admin.authz.policies-list';
  static override loading = { rows: 5 };
  static override empty = {
    heading: 'No policy versions yet',
    body:
      'No Cedar bundle has been authored for this tenant. The engine falls back to allow-all-with-tenant-scope until you create one.',
    action: 'New policy',
  };

  /**
   * Narrow the inherited `data: unknown` to the load() return shape so
   * render() and the test-state reader read it without an `as` cast.
   * `AtlasSurface._runLoad` assigns this field with the load() result.
   */
  declare data: readonly PolicySummary[] | null;

  override async load(): Promise<readonly PolicySummary[]> {
    const result = await listPolicies();
    return result;
  }

  override render(): DocumentFragment {
    const rows = this.data ?? [];
    // Body-slot pattern (ADR-0001): the heading + actions live in the
    // surface frame and stay visible across loading/empty/error states.
    // Only the contents of `[data-surface-body]` get swapped when the
    // framework overlays a non-success state.
    return html`
      <atlas-stack gap="lg">
        <atlas-stack direction="row" justify="space-between" align="center">
          <atlas-heading level="1">Authorization policies</atlas-heading>
          <atlas-button
            name="create-button"
            variant="primary"
            @click=${(): void => {
              this._createNew();
            }}
          >
            New policy
          </atlas-button>
        </atlas-stack>
        <div data-surface-body>
          ${this._renderTable(rows)}
        </div>
      </atlas-stack>
    `;
  }

  private _renderTable(rows: readonly PolicySummary[]): HTMLElement {
    const wrap = document.createElement('atlas-box');
    const table = document.createElement('atlas-table');
    table.setAttribute('name', 'table');
    table.setAttribute('label', 'Policy versions');

    const thead = document.createElement('atlas-table-head');
    const headRow = document.createElement('atlas-row');
    for (const label of ['Version', 'Status', 'Description', 'Last modified', 'By', 'Actions']) {
      const cell = document.createElement('atlas-table-cell');
      cell.setAttribute('header', '');
      cell.textContent = label;
      headRow.appendChild(cell);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('atlas-table-body');
    for (const row of rows) {
      const tr = document.createElement('atlas-row');
      tr.setAttribute('name', 'row');
      tr.setAttribute('key', String(row.version));

      this._appendCell(tr, `v${row.version}`);
      this._appendCell(tr, row.status);
      this._appendCell(tr, row.description ?? '—');
      this._appendCell(tr, this._formatDate(row.lastModifiedAt));
      this._appendCell(tr, row.lastModifiedBy ?? '—');

      const actions = document.createElement('atlas-table-cell');
      const actionStack = document.createElement('atlas-stack');
      actionStack.setAttribute('direction', 'row');
      actionStack.setAttribute('gap', 'sm');

      actionStack.appendChild(this._actionButton('row-view', 'View', () => this._view(row.version)));
      if (row.status === 'draft') {
        actionStack.appendChild(
          this._actionButton('row-activate', 'Activate', () => this._activate(row.version)),
        );
      }
      if (row.status === 'active') {
        actionStack.appendChild(
          this._actionButton('row-archive', 'Archive', () => this._archive(row.version)),
        );
      }
      actionStack.appendChild(this._actionButton('row-diff', 'Diff', () => this._openDiff(row.version)));
      actions.appendChild(actionStack);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  private _appendCell(tr: HTMLElement, text: string): void {
    const cell = document.createElement('atlas-table-cell');
    cell.textContent = text;
    tr.appendChild(cell);
  }

  private _actionButton(name: string, label: string, fn: () => void): HTMLElement {
    const btn = document.createElement('atlas-button');
    btn.setAttribute('name', name);
    btn.setAttribute('variant', name === 'row-archive' ? 'danger' : 'secondary');
    btn.setAttribute('size', 'sm');
    btn.textContent = label;
    btn.addEventListener('click', fn);
    return btn;
  }

  private _formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  private _unsubscribe: (() => void) | null = null;
  private _disposeTestState: (() => void) | null = null;

  override onMount(): void {
    this.emit('admin.authz.policies-list.page-viewed');

    // Expose surface state to Playwright via `window.__atlasTest`.
    // Pattern matches the page-editor shell: register on mount, dispose
    // on unmount. Reader returns the externally-observable shape.
    this._disposeTestState = registerTestState(this.surfaceId, () => ({
      state: this.getAttribute('data-state') ?? 'unknown',
      rowCount: this.data?.length ?? 0,
    }));

    // Reload when a Policy projection event lands.
    // (No projection name yet for authz events — listening on
    // `projection.updated` is a coarse refresh; refines once the
    // worker emits a `policy` resource type.)
    this.addEventListener('empty-action', () => {
      this._createNew();
    });
  }

  override onUnmount(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._disposeTestState) {
      this._disposeTestState();
      this._disposeTestState = null;
    }
  }

  private _createNew(): void {
    this.emit('admin.authz.policies-list.create-clicked');
    window.location.hash = '#/authz/edit/new';
  }

  private _view(version: number): void {
    window.location.hash = `#/authz/edit/${version}`;
  }

  private async _activate(version: number): Promise<void> {
    this.emit('admin.authz.policies-list.row-activate-clicked', { version });
    try {
      await activatePolicy(version);
      await this.reload();
    } catch (e) {
      // Surface a transient error inline; the surface stays in success
      // and the user can retry — no point flipping to error state for
      // a single row's mutation. Emit a structured failure so the
      // telemetry pipeline picks it up instead of a bare console.error.
      this.emit('Atlas.Action.Failed', {
        event: 'Authz.PolicyActivate.Failed',
        version,
        cause: errorMessage(e),
      });
    }
  }

  private async _archive(version: number): Promise<void> {
    this.emit('admin.authz.policies-list.row-archive-clicked', { version });
    try {
      await archivePolicy(version);
      await this.reload();
    } catch (e) {
      this.emit('Atlas.Action.Failed', {
        event: 'Authz.PolicyArchive.Failed',
        version,
        cause: errorMessage(e),
      });
    }
  }

  private _openDiff(version: number): void {
    this.emit('admin.authz.policies-list.row-diff-clicked', { version });
    // Diff dialog is a sibling component; signalled via custom event
    // bubbled up to the shell, which mounts the dialog on demand.
    this.dispatchEvent(
      new CustomEvent('authz-open-diff', {
        detail: { rightVersion: version },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

AtlasSurface.define('policies-list-page', PoliciesListPage);
