/**
 * Login surface — email + password authentication.
 *
 * SurfaceId: `identity.login`.
 *
 * States (per sdet verdict #4): `ready`, `submitting`, `success`, `error`
 * (`data.error.code` from auth taxonomy). On submit dispatches
 * `Identity.Login.Password` (which the server handles end-to-end —
 * AuthSession.Issue + cookie set). On success redirects to `/` per
 * spec-keeper Q3 (the tenant-home stub from public-signup).
 *
 * Critical: `data.draft.password` is REDACTED to literal `'[REDACTED]'`
 * in the test-state snapshot. The form holds the live password in
 * memory only until submit completes.
 *
 * Spec: specs/domains/identity/capabilities/tenant-admin-invites-user/README.md
 */
import { AtlasSurface, html } from '@atlas/core';
import { passwordLogin } from '@atlas/api-client';
import { registerTestState } from '@atlas/test-state';
import '@atlas/design';

type LoginState = 'ready' | 'submitting' | 'success' | 'error';

interface LoginFormShape {
  state: LoginState;
  draft: { email: string; password: string };
  error: { code: string } | null;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

class LoginSurface extends AtlasSurface {
  static override surfaceId = 'identity.login';

  private _form: LoginFormShape = {
    state: 'ready',
    draft: { email: '', password: '' },
    error: null,
  };
  private _disposeTestState: (() => void) | null = null;

  override render(): DocumentFragment {
    const s = this._form;
    return html`
      <atlas-stack gap="lg">
        <atlas-heading level="1">Sign in</atlas-heading>
        ${s.error
          ? html`<atlas-alert variant="error" heading="Sign in failed" name="login-error">
              <atlas-text>${s.error.code}</atlas-text>
            </atlas-alert>`
          : ''}
        <atlas-stack gap="md">
          ${this._renderEmailInput()}
          ${this._renderPasswordInput()}
        </atlas-stack>
        <atlas-button
          name="submit"
          variant="primary"
          ?disabled=${s.state === 'submitting'}
          @click=${(): void => {
            void this._submit();
          }}
        >
          ${s.state === 'submitting' ? 'Signing in…' : 'Sign in'}
        </atlas-button>
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

  private _renderPasswordInput(): HTMLElement {
    const input = document.createElement('atlas-input');
    input.setAttribute('name', 'password');
    input.setAttribute('label', 'Password');
    input.setAttribute('type', 'password');
    input.setAttribute('value', this._form.draft.password);
    input.addEventListener('input', (e: Event) => {
      const t = e.target as HTMLInputElement;
      this._form = {
        ...this._form,
        draft: { ...this._form.draft, password: t.value ?? '' },
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
    const { email, password } = this._form.draft;
    if (!email || !password) {
      this._form = {
        ...this._form,
        state: 'error',
        error: { code: 'identity.credentials.required' },
      };
      this.setAttribute('data-state', 'error');
      this._rerender();
      return;
    }
    this._form = { ...this._form, state: 'submitting', error: null };
    this.setAttribute('data-state', 'submitting');
    this._rerender();
    this.emit('identity.login.submit-clicked', { email });
    try {
      await passwordLogin({ email, password });
      this._form = { ...this._form, state: 'success' };
      this.setAttribute('data-state', 'success');
      // Redirect to the tenant home per spec-keeper Q3. The server sets
      // the session cookie on Identity.AuthSession.Issue; a fresh GET to
      // '/' re-renders tenant-home with the authed principal.
      this._rerender();
      window.location.href = '/';
    } catch (e) {
      const msg = errorMessage(e);
      this._form = {
        ...this._form,
        state: 'error',
        error: { code: msg },
      };
      this.setAttribute('data-state', 'error');
      this._rerender();
    }
  }

  override onMount(): void {
    this.emit('identity.login.page-viewed');
    this.setAttribute('data-state', 'ready');
    this._rerender();
    this._disposeTestState = registerTestState(this.surfaceId, () => ({
      state: this._form.state,
      surfaceId: this.surfaceId,
      data: {
        draft: {
          email: this._form.draft.email,
          // I18 / log-redaction contract: NEVER leak the live password
          // through the test-state snapshot. Even Playwright should not
          // see it — the snapshot reads to the harness over the wire.
          password: '[REDACTED]',
        },
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

AtlasSurface.define('login-surface', LoginSurface);
