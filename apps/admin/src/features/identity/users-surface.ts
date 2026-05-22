/**
 * Identity Users surface — lists memberships for the active tenant.
 *
 * SurfaceId: `identity.users`.
 *
 * States (per sdet verdict #4): `loading`, `success` (`data.memberships`),
 * `empty`, `error`. Single action: `actions[].name === 'invite'` jumps
 * to `#/users/invite`.
 *
 * Reads via `listMemberships()` which calls the query-side catch-all
 * `GET /api/v1/queries/Identity.Memberships.List`. No domain logic here —
 * the surface is a presentation client of the existing identity query.
 *
 * Spec: specs/domains/identity/capabilities/tenant-admin-invites-user/README.md
 */
import { AtlasSurface, html } from '@atlas/core';
import { listMemberships, type MembershipSummary } from '@atlas/api-client';
import { registerTestState } from '@atlas/test-state';
import '@atlas/design';

class UsersSurface extends AtlasSurface {
  static override surfaceId = 'identity.users';
  static override loading = { rows: 4 };
  static override empty = {
    heading: 'No users yet',
    body: 'Invite someone to join this tenant.',
    action: 'Invite user',
  };

  declare data: readonly MembershipSummary[] | null;

  private _disposeTestState: (() => void) | null = null;

  override async load(): Promise<readonly MembershipSummary[]> {
    return listMemberships();
  }

  override render(): DocumentFragment {
    const rows = this.data ?? [];
    return html`
      <atlas-stack gap="lg">
        <atlas-stack direction="row" justify="space-between" align="center">
          <atlas-heading level="1">Users</atlas-heading>
          <atlas-button
            name="invite"
            variant="primary"
            @click=${(): void => {
              this._invite();
            }}
          >
            Invite user
          </atlas-button>
        </atlas-stack>
        <div data-surface-body>
          ${this._renderTable(rows)}
        </div>
      </atlas-stack>
    `;
  }

  private _renderTable(rows: readonly MembershipSummary[]): HTMLElement {
    const wrap = document.createElement('atlas-box');
    const table = document.createElement('atlas-table');
    table.setAttribute('name', 'table');
    table.setAttribute('label', 'Memberships');

    const thead = document.createElement('atlas-table-head');
    const headRow = document.createElement('atlas-row');
    for (const label of ['User', 'Roles', 'Status', 'Created']) {
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
      tr.setAttribute('key', row.membershipId);
      this._appendCell(tr, row.userId);
      this._appendCell(tr, row.roles.join(', '));
      this._appendCell(tr, row.status);
      this._appendCell(tr, row.createdAt);
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

  private _invite(): void {
    this.emit('identity.users.invite-clicked');
    window.location.hash = '#/users/invite';
  }

  override onMount(): void {
    this.emit('identity.users.page-viewed');
    this._disposeTestState = registerTestState(this.surfaceId, () => ({
      state: this.getAttribute('data-state') ?? 'unknown',
      surfaceId: this.surfaceId,
      data: { memberships: this.data ?? [] },
      actions: [{ name: 'invite' }],
    }));
    this.addEventListener('empty-action', () => {
      this._invite();
    });
  }

  override onUnmount(): void {
    if (this._disposeTestState) {
      this._disposeTestState();
      this._disposeTestState = null;
    }
  }
}

AtlasSurface.define('users-surface', UsersSurface);
