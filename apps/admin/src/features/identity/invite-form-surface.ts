/**
 * Invite Form surface — admin invites a user by email + role.
 *
 * SurfaceId: `identity.invite-form`.
 *
 * States (per sdet verdict #4): `ready`, `submitting`, `success`, `error`
 * (`data.errors: { field, code }[]`), `unauthorized`. Submit action +
 * cancel action. Default role: `Viewer`.
 *
 * On submit: dispatches `Identity.Invite.Issue` via the existing intent
 * endpoint (no new HTTP surface).
 *
 * Spec: specs/domains/identity/capabilities/tenant-admin-invites-user/README.md
 */
import { AtlasSurface, html } from '@atlas/core';
import { issueInvite } from '@atlas/api-client';
import { registerTestState } from '@atlas/test-state';
import '@atlas/design';

type FormState = 'ready' | 'submitting' | 'success' | 'error' | 'unauthorized';

interface FormError {
  field: string;
  code: string;
}

interface FormShape {
  state: FormState;
  draft: { email: string; role: string };
  errors: FormError[];
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

class InviteFormSurface extends AtlasSurface {
  static override surfaceId = 'identity.invite-form';

  private _form: FormShape = {
    state: 'ready',
    draft: { email: '', role: 'Viewer' },
    errors: [],
  };
  private _disposeTestState: (() => void) | null = null;

  override render(): DocumentFragment {
    const s = this._form;
    return html`
      <atlas-stack gap="lg">
        <atlas-heading level="1">Invite user</atlas-heading>
        ${s.errors.length > 0
          ? html`<atlas-alert variant="error" heading="Could not send invite" name="invite-errors">
              <atlas-stack gap="xs">
                ${s.errors.map(function (e) {
                  return html`<atlas-text>${e.field}: ${e.code}</atlas-text>`;
                })}
              </atlas-stack>
            </atlas-alert>`
          : ''}
        <atlas-stack gap="md">
          ${this._renderEmailInput()}
          ${this._renderRoleSelect()}
        </atlas-stack>
        <atlas-stack direction="row" gap="sm">
          <atlas-button
            name="submit"
            variant="primary"
            ?disabled=${s.state === 'submitting'}
            @click=${(): void => {
              void this._submit();
            }}
          >
            ${s.state === 'submitting' ? 'Sending…' : 'Send invite'}
          </atlas-button>
          <atlas-button
            name="cancel"
            variant="secondary"
            @click=${(): void => {
              this._cancel();
            }}
          >
            Cancel
          </atlas-button>
        </atlas-stack>
      </atlas-stack>
    `;
  }

  private _renderEmailInput(): HTMLElement {
    const input = document.createElement('atlas-input');
    input.setAttribute('name', 'email');
    input.setAttribute('label', 'Email');
    input.setAttribute('type', 'email');
    input.setAttribute('value', this._form.draft.email);
    input.addEventListener('input', (e: Event) => {
      const t = e.target as HTMLInputElement;
      this._form = {
        ...this._form,
        draft: { ...this._form.draft, email: t.value ?? '' },
      };
    });
    return input;
  }

  private _renderRoleSelect(): HTMLElement {
    // For the slice we keep it as a simple text input — Viewer is the
    // default. A future enhancement (atlas-select) is out of scope here.
    const input = document.createElement('atlas-input');
    input.setAttribute('name', 'role');
    input.setAttribute('label', 'Role');
    input.setAttribute('value', this._form.draft.role);
    input.addEventListener('input', (e: Event) => {
      const t = e.target as HTMLInputElement;
      this._form = {
        ...this._form,
        draft: { ...this._form.draft, role: t.value ?? 'Viewer' },
      };
    });
    return input;
  }

  private _rerender(): void {
    const fragment = this.render();
    this.textContent = '';
    this.appendChild(fragment);
  }

  private async _submit(): Promise<void> {
    const { email, role } = this._form.draft;
    if (!email || !role) {
      this._form = {
        ...this._form,
        state: 'error',
        errors: [
          ...(!email ? [{ field: 'email', code: 'required' } as FormError] : []),
          ...(!role ? [{ field: 'role', code: 'required' } as FormError] : []),
        ],
      };
      this.setState('error');
      this._rerender();
      return;
    }
    this._form = { ...this._form, state: 'submitting', errors: [] };
    this.setState('loading');
    this._rerender();
    this.emit('identity.invite-form.submit-clicked', { email, role });
    try {
      await issueInvite({ email, rolesOnAccept: [role] });
      this._form = { ...this._form, state: 'success' };
      this.setState('success');
      this._rerender();
    } catch (e) {
      const msg = errorMessage(e);
      const unauthorized = /403|unauthor/i.test(msg);
      this._form = {
        ...this._form,
        state: unauthorized ? 'unauthorized' : 'error',
        errors: [{ field: 'submit', code: msg }],
      };
      this.setState(unauthorized ? 'unauthorized' : 'error');
      this._rerender();
    }
  }

  private _cancel(): void {
    this.emit('identity.invite-form.cancel-clicked');
    window.location.hash = '#/users';
  }

  override onMount(): void {
    this.emit('identity.invite-form.page-viewed');
    this.setState('success'); // 'ready' frame is mounted; map to success so the frame renders
    this._form = { ...this._form, state: 'ready' };
    // Override the data-state to 'ready' so the snapshot reflects the
    // surface contract. AtlasSurface's setState only takes the canonical
    // SurfaceState; we mirror our finer-grained `_form.state` via the
    // test-state reader.
    this.setAttribute('data-state', 'ready');
    this._rerender();
    this._disposeTestState = registerTestState(this.surfaceId, () => ({
      state: this._form.state,
      surfaceId: this.surfaceId,
      data: {
        draft: { ...this._form.draft },
        errors: this._form.errors,
      },
      actions: [{ name: 'submit' }, { name: 'cancel' }],
    }));
  }

  override onUnmount(): void {
    if (this._disposeTestState) {
      this._disposeTestState();
      this._disposeTestState = null;
    }
  }
}

AtlasSurface.define('invite-form-surface', InviteFormSurface);
