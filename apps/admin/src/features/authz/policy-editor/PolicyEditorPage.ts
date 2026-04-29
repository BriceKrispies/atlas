/**
 * Policy editor — three-pane authoring + simulator surface.
 *
 * Left: <atlas-code-editor> over the policy's Cedar source.
 * Right top: <atlas-json-view> showing the parsed AST (best-effort
 *   parse via cedar-wasm/web's `policySetTextToParts`).
 * Right bottom: <atlas-box> simulator — inputs + Evaluate button +
 *   client-side decision (decision / matched policies / reasons).
 *
 * cedar-wasm/web is lazy-loaded via `simulator.ts` so the rest of the
 * admin bundle doesn't pay the ~1.5MB gzipped cost.
 */

import { AtlasSurface, html } from '@atlas/core';
import {
  getPolicy,
  createPolicy,
  activatePolicy,
  type PolicyDetail,
} from '@atlas/api-client';
import '@atlas/design';
import { evaluateRequest, validateCedarText, warmupSimulator } from './simulator.ts';
import type { SimulatorRequest, SimulatorResult } from './simulator.ts';

const NEW = 'new';

interface EditorState {
  version: string;
  cedarText: string;
  status: 'draft' | 'active' | 'archived' | 'new';
  validationErrors: readonly string[];
  saving: boolean;
  activating: boolean;
  lastSimulatorResult: SimulatorResult | null;
  simulatorError: string | null;
  loadError: string | null;
}

const DEFAULT_DRAFT_TEXT = `// Author your tenant's Cedar policy bundle here.
// Each policy SHOULD have an @id annotation so audit events surface
// human-named ids.

@id("example-permit")
permit (
  principal,
  action == Action::"Catalog.Family.Publish",
  resource is Family
);
`;

class PolicyEditorPage extends AtlasSurface {
  static override surfaceId = 'admin.authz.policy-editor';

  private _state: EditorState = {
    version: NEW,
    cedarText: '',
    status: 'new',
    validationErrors: [],
    saving: false,
    activating: false,
    lastSimulatorResult: null,
    simulatorError: null,
    loadError: null,
  };
  private _validateTimer: number | null = null;

  /**
   * Imperative re-render — replaces children with the result of
   * `render()`. Sidesteps the signal-based reactive effect AtlasSurface
   * uses by default; the editor's local state isn't a signal so we
   * trigger updates by hand from event handlers.
   *
   * Followup (next chunk): migrate `_state` to a signal so the base
   * class's reactive effect handles re-rendering — preserves
   * `<atlas-code-editor>` cursor + scroll across updates.
   *
   * The validation path explicitly DOES NOT call this (`_runValidation`
   * uses `_applyValidationDom` for surgical updates) because firing
   * `_rerender` every 250ms while the user types destroys cursor +
   * scroll inside `<atlas-code-editor>` — a real UX regression caught
   * by the 6d audit.
   */
  private _rerender(): void {
    const fragment = this.render();
    this.textContent = '';
    this.appendChild(fragment);
  }

  /**
   * Surgical update for the validation-only path. Mutates the
   * validation-alert region and the disabled state of the save/activate
   * buttons in-place, preserving the live `<atlas-code-editor>` so the
   * cursor + scroll position survive each debounced validation cycle.
   */
  private _applyValidationDom(errors: readonly string[]): void {
    const saveBtn = this.querySelector(
      'atlas-button[name="save-button"]',
    ) as (HTMLElement & { disabled?: boolean }) | null;
    const activateBtn = this.querySelector(
      'atlas-button[name="activate-button"]',
    ) as (HTMLElement & { disabled?: boolean }) | null;
    if (saveBtn) saveBtn.toggleAttribute('disabled', this._state.saving || errors.length > 0);
    if (activateBtn)
      activateBtn.toggleAttribute(
        'disabled',
        this._state.activating || this._state.status !== 'draft' || errors.length > 0,
      );

    const existingAlert = this.querySelector('atlas-alert[name="validation-alert"]');
    if (errors.length === 0) {
      existingAlert?.remove();
      return;
    }

    if (existingAlert) {
      existingAlert.textContent = '';
      const stack = document.createElement('atlas-stack');
      stack.setAttribute('gap', 'xs');
      for (const m of errors) {
        const t = document.createElement('atlas-text');
        t.textContent = m;
        stack.appendChild(t);
      }
      existingAlert.appendChild(stack);
      return;
    }

    const alert = document.createElement('atlas-alert');
    alert.setAttribute('name', 'validation-alert');
    alert.setAttribute('variant', 'warning');
    alert.setAttribute('heading', 'Cedar validation errors');
    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'xs');
    for (const m of errors) {
      const t = document.createElement('atlas-text');
      t.textContent = m;
      stack.appendChild(t);
    }
    alert.appendChild(stack);
    // Insert after the heading row so the alert appears at the top of
    // the surface, matching what `render()` produces.
    const grid = this.querySelector('atlas-grid');
    if (grid?.parentElement) {
      grid.parentElement.insertBefore(alert, grid);
    } else {
      this.appendChild(alert);
    }
  }

  override async load(): Promise<EditorState> {
    const version = this._versionFromHash();
    if (version === NEW) {
      this._state = {
        ...this._state,
        version: NEW,
        cedarText: DEFAULT_DRAFT_TEXT,
        status: 'new',
        loadError: null,
      };
    } else {
      try {
        const detail = await getPolicy(Number(version));
        if (!detail) {
          this._state = {
            ...this._state,
            loadError: `Policy version ${version} not found`,
          };
        } else {
          this._applyDetail(detail);
        }
      } catch (e) {
        this._state = {
          ...this._state,
          loadError: (e as Error).message,
        };
      }
    }
    return this._state;
  }

  private _applyDetail(detail: PolicyDetail): void {
    this._state = {
      ...this._state,
      version: String(detail.version),
      cedarText: detail.cedarText,
      status: detail.status,
      loadError: null,
    };
  }

  private _versionFromHash(): string {
    const hash = window.location.hash;
    const match = /#\/authz\/edit\/([^/?#]+)/.exec(hash);
    return match?.[1] ?? NEW;
  }

  override onMount(): void {
    this.emit('admin.authz.policy-editor.page-viewed', { version: this._state.version });
    // Pre-warm cedar-wasm so the first Evaluate click is snappy. Failure
    // is non-fatal; the simulator surfaces errors when the user clicks.
    void warmupSimulator().catch(() => {
      /* swallow — surfaced on first run */
    });
    void this._scheduleValidation();
  }

  override onUnmount(): void {
    if (this._validateTimer !== null) {
      window.clearTimeout(this._validateTimer);
      this._validateTimer = null;
    }
  }

  override render(): DocumentFragment {
    const s = this._state;
    return html`
      <atlas-stack gap="lg">
        <atlas-stack direction="row" justify="space-between" align="center">
          <atlas-heading level="1">
            ${s.version === NEW ? 'New policy' : `Policy version ${s.version}`}
          </atlas-heading>
          <atlas-stack direction="row" gap="sm">
            <atlas-button
              name="save-button"
              variant="primary"
              ?disabled=${s.saving || s.validationErrors.length > 0}
              @click=${(): void => {
                void this._save();
              }}
            >
              ${s.saving ? 'Saving…' : 'Save draft'}
            </atlas-button>
            <atlas-button
              name="activate-button"
              variant="secondary"
              ?disabled=${s.activating || s.status !== 'draft' || s.validationErrors.length > 0}
              @click=${(): void => {
                void this._activate();
              }}
            >
              ${s.activating ? 'Activating…' : 'Activate'}
            </atlas-button>
          </atlas-stack>
        </atlas-stack>

        ${s.validationErrors.length > 0
          ? html`
              <atlas-alert
                name="validation-alert"
                variant="warning"
                heading="Cedar validation errors"
              >
                <atlas-stack gap="xs">
                  ${s.validationErrors.map((m) => html`<atlas-text>${m}</atlas-text>`)}
                </atlas-stack>
              </atlas-alert>
            `
          : ''}

        ${s.loadError !== null
          ? html`<atlas-alert variant="error" heading="Could not load policy">
              <atlas-text>${s.loadError}</atlas-text>
            </atlas-alert>`
          : ''}

        <atlas-grid columns="2" gap="lg">
          ${this._renderEditorPane()} ${this._renderRightPane()}
        </atlas-grid>
      </atlas-stack>
    `;
  }

  private _renderEditorPane(): HTMLElement {
    const wrap = document.createElement('atlas-box');
    const editor = document.createElement('atlas-code-editor');
    editor.setAttribute('name', 'cedar-editor');
    editor.setAttribute('language', 'text');
    editor.setAttribute('label', 'Cedar source');
    // The editor exposes a `value` property and `change` event — set
    // both imperatively because property bindings via the `html` helper
    // don't currently support `.value=${...}` for custom elements that
    // override property accessors.
    (editor as unknown as { value: string }).value = this._state.cedarText;
    editor.addEventListener('change', (e: Event) => {
      const v = (e as CustomEvent<{ value: string }>).detail?.value;
      if (typeof v === 'string') {
        this._state = { ...this._state, cedarText: v };
        this._scheduleValidation();
      }
    });
    wrap.appendChild(editor);
    return wrap;
  }

  private _renderRightPane(): HTMLElement {
    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'lg');
    stack.appendChild(this._renderAstPane());
    stack.appendChild(this._renderSimulatorPane());
    return stack;
  }

  private _renderAstPane(): HTMLElement {
    const wrap = document.createElement('atlas-box');
    const heading = document.createElement('atlas-heading');
    heading.setAttribute('level', '3');
    heading.textContent = 'Parsed policies';
    wrap.appendChild(heading);
    const view = document.createElement('atlas-json-view');
    view.setAttribute('name', 'ast-view');
    // Best-effort summary — counts of permit/forbid/templates
    const summary = this._summarise(this._state.cedarText);
    (view as unknown as { value: unknown }).value = summary;
    wrap.appendChild(view);
    return wrap;
  }

  private _summarise(cedarText: string): Record<string, unknown> {
    const permits = (cedarText.match(/(^|\n)\s*permit\s*\(/g) ?? []).length;
    const forbids = (cedarText.match(/(^|\n)\s*forbid\s*\(/g) ?? []).length;
    const annotated = (cedarText.match(/@id\s*\(/g) ?? []).length;
    return {
      permitRules: permits,
      forbidRules: forbids,
      annotatedRules: annotated,
      bytes: cedarText.length,
    };
  }

  private _renderSimulatorPane(): HTMLElement {
    const box = document.createElement('atlas-box');
    const h = document.createElement('atlas-heading');
    h.setAttribute('level', '3');
    h.textContent = 'Simulator';
    box.appendChild(h);

    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'sm');

    stack.appendChild(this._input('simulator-principal-id', 'Principal ID', 'user-001'));
    stack.appendChild(this._input('simulator-action', 'Action', 'Authz.Policy.List'));
    stack.appendChild(this._input('simulator-resource-type', 'Resource type', 'Policy'));
    stack.appendChild(this._input('simulator-resource-id', 'Resource ID', '1'));

    const evalBtn = document.createElement('atlas-button');
    evalBtn.setAttribute('name', 'simulator-evaluate');
    evalBtn.setAttribute('variant', 'primary');
    evalBtn.textContent = 'Evaluate';
    evalBtn.addEventListener('click', () => {
      void this._runSimulator(box);
    });
    stack.appendChild(evalBtn);

    const result = document.createElement('atlas-box');
    result.setAttribute('name', 'simulator-result');
    if (this._state.simulatorError !== null) {
      result.textContent = `Error: ${this._state.simulatorError}`;
    } else if (this._state.lastSimulatorResult !== null) {
      const r = this._state.lastSimulatorResult;
      const matched =
        r.matchedPolicies.length > 0 ? r.matchedPolicies.join(', ') : '(none)';
      result.textContent = `${r.decision.toUpperCase()} — matched: ${matched} — reasons: ${r.reasons.join(' | ')}`;
    } else {
      result.textContent = 'No simulator run yet.';
    }
    stack.appendChild(result);

    box.appendChild(stack);
    return box;
  }

  private _input(name: string, label: string, defaultValue: string): HTMLElement {
    const el = document.createElement('atlas-input');
    el.setAttribute('name', name);
    el.setAttribute('label', label);
    el.setAttribute('value', defaultValue);
    return el;
  }

  private _readSimulatorInputs(host: HTMLElement): SimulatorRequest {
    const read = (n: string): string => {
      const el = host.querySelector(
        `atlas-input[name="${n}"]`,
      ) as HTMLElement | null;
      const v = (el as unknown as { value?: string } | null)?.value;
      return typeof v === 'string' ? v : '';
    };
    return {
      principalId: read('simulator-principal-id') || 'user-001',
      action: read('simulator-action') || 'Authz.Policy.List',
      resourceType: read('simulator-resource-type') || 'Policy',
      resourceId: read('simulator-resource-id') || '1',
    };
  }

  private async _runSimulator(host: HTMLElement): Promise<void> {
    const req = this._readSimulatorInputs(host);
    try {
      const result = await evaluateRequest(this._state.cedarText, req);
      this._state = {
        ...this._state,
        lastSimulatorResult: result,
        simulatorError: null,
      };
      this.emit('admin.authz.policy-editor.simulator-run', { decision: result.decision });
    } catch (e) {
      this._state = {
        ...this._state,
        simulatorError: (e as Error).message,
        lastSimulatorResult: null,
      };
      this.emit('admin.authz.policy-editor.simulator-run', { decision: 'error' });
    }
    // Trigger re-render via setData (AtlasSurface re-renders when data
    // identity changes).
    this._rerender();
  }

  private _scheduleValidation(): void {
    if (this._validateTimer !== null) {
      window.clearTimeout(this._validateTimer);
    }
    this._validateTimer = window.setTimeout(() => {
      void this._runValidation();
    }, 250);
  }

  private async _runValidation(): Promise<void> {
    let errs: readonly string[];
    try {
      errs = await validateCedarText(this._state.cedarText);
      this.emit('admin.authz.policy-editor.validated', { ok: errs.length === 0 });
    } catch (e) {
      // cedar-wasm load error — surface as a single validation entry so
      // the user knows save will still work but real-time validation
      // is degraded.
      errs = [`cedar-wasm: ${(e as Error).message}`];
    }
    this._state = { ...this._state, validationErrors: errs };
    // Surgical DOM update — preserves <atlas-code-editor> cursor +
    // scroll. See `_rerender` doc for the regression this avoids.
    this._applyValidationDom(errs);
  }

  private async _save(): Promise<void> {
    this._state = { ...this._state, saving: true };
    this._rerender();
    try {
      await createPolicy({ cedarText: this._state.cedarText });
      this.emit('admin.authz.policy-editor.saved', { version: this._state.version });
      window.location.hash = '#/authz/policies';
    } catch (e) {
      this._state = {
        ...this._state,
        saving: false,
        loadError: (e as Error).message,
      };
      this._rerender();
    }
  }

  private async _activate(): Promise<void> {
    if (this._state.version === NEW) return;
    this._state = { ...this._state, activating: true };
    this._rerender();
    try {
      await activatePolicy(Number(this._state.version));
      this.emit('admin.authz.policy-editor.activated', { version: this._state.version });
      window.location.hash = '#/authz/policies';
    } catch (e) {
      this._state = {
        ...this._state,
        activating: false,
        loadError: (e as Error).message,
      };
      this._rerender();
    }
  }
}

AtlasSurface.define('policy-editor-page', PolicyEditorPage);
