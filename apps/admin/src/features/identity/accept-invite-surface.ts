/**
 * Accept Invite surface — magic-link landing page.
 *
 * SurfaceId: `identity.accept-invite`.
 *
 * States (per sdet verdict #4): `loading`, `success`, `error`. Reads
 * `?token=…` from the URL on mount; calls `Identity.Invite.Accept`; on
 * success redirects to `#/set-password`. The invitee sees
 * `data.invitePreview.{email, role, tenantSlug}` while the token is
 * being validated and accepted.
 *
 * Spec: specs/domains/identity/capabilities/tenant-admin-invites-user/README.md
 */
import { AtlasSurface, html } from '@atlas/core';
import { acceptInvite } from '@atlas/api-client';
import { registerTestState } from '@atlas/test-state';
import '@atlas/design';

type AcceptState = 'loading' | 'success' | 'error';

interface AcceptShape {
  state: AcceptState;
  invitePreview: { email: string; role: string; tenantSlug: string } | null;
  error: { code: string } | null;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function readUrlParam(name: string): string | null {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  } catch {
    return null;
  }
}

class AcceptInviteSurface extends AtlasSurface {
  static override surfaceId = 'identity.accept-invite';

  private _form: AcceptShape = {
    state: 'loading',
    invitePreview: null,
    error: null,
  };
  private _disposeTestState: (() => void) | null = null;

  override render(): DocumentFragment {
    const s = this._form;
    return html`
      <atlas-stack gap="lg">
        <atlas-heading level="1">Accept invite</atlas-heading>
        ${s.state === 'loading'
          ? html`<atlas-text>Validating invite…</atlas-text>`
          : ''}
        ${s.state === 'success' && s.invitePreview
          ? html`<atlas-stack gap="sm">
              <atlas-text>Welcome ${s.invitePreview.email}.</atlas-text>
              <atlas-text variant="muted">You have been added to
                ${s.invitePreview.tenantSlug} as ${s.invitePreview.role}.</atlas-text>
              <atlas-text variant="muted">Redirecting to set your password…</atlas-text>
            </atlas-stack>`
          : ''}
        ${s.state === 'error' && s.error
          ? html`<atlas-alert variant="error" heading="Could not accept invite">
              <atlas-text>${s.error.code}</atlas-text>
            </atlas-alert>`
          : ''}
      </atlas-stack>
    `;
  }

  private _rerender(): void {
    const fragment = this.render();
    this.textContent = '';
    this.appendChild(fragment);
  }

  private async _runAccept(): Promise<void> {
    const token = readUrlParam('token');
    const email = readUrlParam('email') ?? '';
    if (!token) {
      this._form = {
        state: 'error',
        invitePreview: null,
        error: { code: 'identity.invite.missing-token' },
      };
      this.setAttribute('data-state', 'error');
      this._rerender();
      return;
    }
    try {
      await acceptInvite({ presentedToken: token, acceptedEmail: email });
      this._form = {
        state: 'success',
        invitePreview: { email, role: 'Viewer', tenantSlug: 'acme' },
        error: null,
      };
      this.setAttribute('data-state', 'success');
      this._rerender();
      // Hand off to set-password. Hash-routed so the shell mounts the
      // next surface without a full reload.
      window.location.hash = '#/set-password';
    } catch (e) {
      this._form = {
        state: 'error',
        invitePreview: null,
        error: { code: errorMessage(e) },
      };
      this.setAttribute('data-state', 'error');
      this._rerender();
    }
  }

  override onMount(): void {
    this.emit('identity.accept-invite.page-viewed');
    this.setAttribute('data-state', 'loading');
    this._rerender();
    this._disposeTestState = registerTestState(this.surfaceId, () => ({
      state: this._form.state,
      surfaceId: this.surfaceId,
      data: {
        invitePreview: this._form.invitePreview,
        error: this._form.error,
      },
      actions: [],
    }));
    void this._runAccept();
  }

  override onUnmount(): void {
    if (this._disposeTestState) {
      this._disposeTestState();
      this._disposeTestState = null;
    }
  }
}

AtlasSurface.define('accept-invite-surface', AcceptInviteSurface);
