/**
 * Set Password surface — invitee sets their initial password.
 *
 * SurfaceId: `identity.set-password`.
 *
 * States (per sdet verdict #4): `ready`, `submitting`, `success`, `error`
 * (`data.error.code` from password-complexity rules). On submit dispatches
 * `Identity.User.SetPassword`; on success redirects to `#/login`.
 *
 * The userId comes from the just-accepted invite session — we read it
 * via the `userId` URL param the accept flow appends, or fall back to
 * the session's cookie identity (the server picks it up server-side).
 *
 * Spec: specs/domains/identity/capabilities/tenant-admin-invites-user/README.md
 */
import { AtlasSurface, html } from '@atlas/core';
import { setUserPassword } from '@atlas/api-client';
import { registerTestState } from '@atlas/test-state';
import '@atlas/design';

type FormState = 'ready' | 'submitting' | 'success' | 'error';

interface FormShape {
  state: FormState;
  draft: { password: string };
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

class SetPasswordSurface extends AtlasSurface {
  static override surfaceId = 'identity.set-password';

  private _form: FormShape = {
    state: 'ready',
    draft: { password: '' },
    error: null,
  };
  private _disposeTestState: (() => void) | null = null;

  override render(): DocumentFragment {
    const s = this._form;
    return html`
      <atlas-stack gap="lg">
        <atlas-heading level="1">Set your password</atlas-heading>
        ${s.error
          ? html`<atlas-alert variant="error" heading="Could not set password" name="set-password-error">
              <atlas-text>${s.error.code}</atlas-text>
            </atlas-alert>`
          : ''}
        ${this._renderPasswordInput()}
        <atlas-button
          name="submit"
          variant="primary"
          ?disabled=${s.state === 'submitting'}
          @click=${(): void => {
            void this._submit();
          }}
        >
          ${s.state === 'submitting' ? 'Saving…' : 'Set password'}
        </atlas-button>
      </atlas-stack>
    `;
  }

  private _renderPasswordInput(): HTMLElement {
    const input = document.createElement('atlas-input');
    input.setAttribute('name', 'password');
    input.setAttribute('label', 'New password');
    input.setAttribute('type', 'password');
    input.setAttribute('value', this._form.draft.password);
    input.addEventListener('input', (e: Event) => {
      const t = e.target as HTMLInputElement;
      this._form = {
        ...this._form,
        draft: { password: t.value ?? '' },
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
    const { password } = this._form.draft;
    const userId = readUrlParam('userId') ?? '';
    if (!password) {
      this._form = {
        ...this._form,
        state: 'error',
        error: { code: 'identity.password.required' },
      };
      this.setAttribute('data-state', 'error');
      this._rerender();
      return;
    }
    this._form = { ...this._form, state: 'submitting', error: null };
    this.setAttribute('data-state', 'submitting');
    this._rerender();
    this.emit('identity.set-password.submit-clicked');
    try {
      await setUserPassword({ userId, newPassword: password });
      this._form = { ...this._form, state: 'success' };
      this.setAttribute('data-state', 'success');
      this._rerender();
      window.location.hash = '#/login';
    } catch (e) {
      this._form = {
        ...this._form,
        state: 'error',
        error: { code: errorMessage(e) },
      };
      this.setAttribute('data-state', 'error');
      this._rerender();
    }
  }

  override onMount(): void {
    this.emit('identity.set-password.page-viewed');
    this.setAttribute('data-state', 'ready');
    this._rerender();
    this._disposeTestState = registerTestState(this.surfaceId, () => ({
      state: this._form.state,
      surfaceId: this.surfaceId,
      data: {
        // password redacted in the snapshot — mirrors login-surface's
        // contract; the form holds the live value only until submit.
        draft: { password: '[REDACTED]' },
        error: this._form.error,
      },
      actions: [{ name: 'submit' }],
    }));
  }

  override onUnmount(): void {
    if (this._disposeTestState) {
      this._disposeTestState();
      this._disposeTestState = null;
    }
  }
}

AtlasSurface.define('set-password-surface', SetPasswordSurface);
