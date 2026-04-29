import { AtlasSurface, html } from '@atlas/core';
import {
  listPolicies,
  activatePolicy,
  archivePolicy,
  type PolicySummary,
} from '@atlas/api-client';
import '@atlas/design';

interface ProjectionUpdatedEvent {
  resourceType?: string;
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

  override async load(): Promise<readonly PolicySummary[]> {
    const result = await listPolicies();
    return result;
  }

  override render(): DocumentFragment {
    const rows = (this.data as readonly PolicySummary[] | null) ?? [];
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
        ${this._renderTable(rows)}
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

  override onMount(): void {
    this.emit('admin.authz.policies-list.page-viewed');

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
      // a single row's mutation.
      // eslint-disable-next-line no-console
      console.error('activate failed', e);
    }
  }

  private async _archive(version: number): Promise<void> {
    this.emit('admin.authz.policies-list.row-archive-clicked', { version });
    try {
      await archivePolicy(version);
      await this.reload();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('archive failed', e);
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
