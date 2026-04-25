/**
 * <page-editor-property-panel> — schema-driven property editor.
 *
 * Given a widget manifest's configSchema and the current instance config,
 * renders a form whose controls map 1:1 to JSON Schema properties. A
 * debounced onChange callback propagates edits back to the shell, which
 * commits them via `contentPageEl.editor.update({ instanceId, config })`.
 *
 * Control mapping for Phase C (v0):
 *   - string + enum           → button row (chip per enum value)
 *   - string                  → <atlas-input type="text">
 *   - integer / number        → <atlas-input type="number">
 *   - boolean                 → toggle button
 *   - array (primitive items) → <atlas-input> with comma-separated values
 *   - array (object items)    → <atlas-input> with JSON fallback textarea
 *   - object                  → JSON textarea fallback
 *
 * On ok=false from the editor, the shell calls `panel.setError(reason)` and
 * the latest reason is shown inline. Stable reason codes map to friendlier
 * messages.
 *
 * C2: elements use `name` attributes so testIds derive automatically.
 * C11: rendering uses atlas-* elements + a single native <textarea>
 * fallback for object fields (no clean atlas primitive for multi-line JSON
 * yet); this is marked as a deferred cleanup.
 */

import { AtlasElement } from '@atlas/core';

type PropertyConfig = Record<string, unknown>;

interface JsonSchema {
  title?: string;
  type?: string;
  default?: unknown;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  [k: string]: unknown;
}

export interface PropertyPanelConfigureArgs {
  widgetId: string;
  instanceId: string;
  config: PropertyConfig;
  schema: JsonSchema;
}

const REASON_MESSAGES: Record<string, string> = {
  'region-invalid': 'Region is not declared on this template.',
  'index-invalid': 'Index out of range for this region.',
  'max-widgets': 'Region already contains the maximum number of widgets.',
  'unknown-widget': 'Widget is not registered in the active bundle.',
  'required-region-empty': 'A required region cannot be emptied.',
  'duplicate-instance-id': 'That instance id already exists on this page.',
  'instance-not-found': 'Widget instance is no longer on the page.',
  'invalid-entry': 'Widget entry is not valid.',
  'persist-failed': 'Save failed; edit was rolled back.',
  'not-editable': 'This page is not editable.',
  'invalid-config': 'Config failed schema validation.',
};

export class PageEditorPropertyPanel extends AtlasElement {
  private _widgetId: string | null = null;
  private _instanceId: string | null = null;
  private _config: PropertyConfig = {};
  private _schema: JsonSchema | null = null;
  private _error: string | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;

  onChange: (config: PropertyConfig) => void = () => {};

  /**
   * Populate the panel with a widget's current config + schema.
   */
  configure({ widgetId, instanceId, config, schema }: PropertyPanelConfigureArgs): void {
    this._widgetId = widgetId;
    this._instanceId = instanceId;
    this._config = cloneDeep(config ?? {}) as PropertyConfig;
    this._schema = schema;
    this._error = null;
    if (this.isConnected) this._render();
  }

  clear(): void {
    this._widgetId = null;
    this._instanceId = null;
    this._config = {};
    this._schema = null;
    this._error = null;
    if (this.isConnected) this._render();
  }

  /**
   * Show a validation or editor-rejection error inline.
   */
  setError(reasonOrMessage: string | null): void {
    if (!reasonOrMessage) {
      this._error = null;
    } else {
      this._error = REASON_MESSAGES[reasonOrMessage] ?? String(reasonOrMessage);
    }
    if (this.isConnected) this._render();
  }

  override connectedCallback(): void {
    super.connectedCallback?.();
    this._render();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback?.();
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  private _render(): void {
    this.textContent = '';
    if (!this._instanceId || !this._schema) {
      this.appendChild(
        makeText('Select a widget to edit its properties.', { variant: 'muted' }),
      );
      return;
    }

    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'sm');

    const heading = document.createElement('atlas-heading');
    heading.setAttribute('level', '4');
    heading.setAttribute('name', 'inspector-title');
    heading.textContent = this._schema.title ?? this._widgetId ?? 'Properties';
    stack.appendChild(heading);

    const sub = makeText(
      `${this._widgetId ?? ''} · ${this._instanceId}`,
      { variant: 'small' },
    );
    sub.setAttribute('name', 'inspector-subtitle');
    stack.appendChild(sub);

    const props = this._schema.properties ?? {};
    for (const [key, propSchema] of Object.entries(props)) {
      const field = this._renderField(key, propSchema);
      if (field) stack.appendChild(field);
    }

    if (this._error) {
      const err = makeText(this._error, { variant: 'error' });
      err.setAttribute('name', 'inspector-error');
      stack.appendChild(err);
    }

    this.appendChild(stack);
  }

  private _renderField(key: string, schema: JsonSchema): HTMLElement | null {
    const type = schema.type;
    const enumValues = Array.isArray(schema.enum) ? (schema.enum as unknown[]) : null;
    const current = this._config?.[key];

    if (enumValues && type === 'string') {
      return this._renderEnumField(key, schema, enumValues as string[], current);
    }
    if (type === 'string') {
      return this._renderStringField(key, schema, current);
    }
    if (type === 'integer' || type === 'number') {
      return this._renderNumberField(key, schema, current);
    }
    if (type === 'boolean') {
      return this._renderBoolField(key, schema, current);
    }
    if (type === 'array') {
      return this._renderArrayField(key, schema, current);
    }
    if (type === 'object') {
      return this._renderObjectField(key, schema, current);
    }
    // Unknown type — degrade to JSON textarea.
    return this._renderObjectField(key, schema, current);
  }

  private _renderStringField(key: string, schema: JsonSchema, current: unknown): HTMLElement {
    const wrap = document.createElement('atlas-box');
    wrap.setAttribute('name', `field-${key}`);
    const input = document.createElement('atlas-input');
    input.setAttribute('label', labelFor(key, schema));
    input.setAttribute('type', 'text');
    const value = current ?? schema.default ?? '';
    input.setAttribute('value', String(value));
    // atlas-input reads value from its shadow <input>, so we also set
    // it imperatively once connected.
    queueMicrotask(() => {
      const inner = input.shadowRoot?.querySelector('input') as HTMLInputElement | null;
      if (inner && inner.value !== String(value)) inner.value = String(value);
    });
    // Live property preview: update the selected block per keystroke.
    // Phase 2a moved per-keystroke semantics onto `input`; `change`
    // now fires only on blur/commit.
    input.addEventListener('input', (e: Event) => {
      const detail = (e as CustomEvent<{ value?: string }>).detail;
      this._update(key, detail?.value ?? '');
    });
    wrap.appendChild(input);
    return wrap;
  }

  private _renderNumberField(key: string, schema: JsonSchema, current: unknown): HTMLElement {
    const wrap = document.createElement('atlas-box');
    wrap.setAttribute('name', `field-${key}`);
    const input = document.createElement('atlas-input');
    input.setAttribute('label', labelFor(key, schema));
    input.setAttribute('type', 'number');
    const value = current ?? schema.default ?? '';
    input.setAttribute('value', String(value));
    queueMicrotask(() => {
      const inner = input.shadowRoot?.querySelector('input') as HTMLInputElement | null;
      if (inner && inner.value !== String(value)) inner.value = String(value);
    });
    // Live numeric preview: parse + update on every keystroke. Invalid
    // intermediate values (empty, partial like "-" or "1.") drop through
    // without clobbering the last valid state.
    input.addEventListener('input', (e: Event) => {
      const detail = (e as CustomEvent<{ value?: string }>).detail;
      const raw = detail?.value ?? '';
      if (raw === '') {
        this._update(key, undefined);
        return;
      }
      const n = schema.type === 'integer' ? parseInt(raw, 10) : Number(raw);
      if (Number.isFinite(n)) this._update(key, n);
    });
    wrap.appendChild(input);
    return wrap;
  }

  private _renderBoolField(key: string, schema: JsonSchema, current: unknown): HTMLElement {
    const wrap = document.createElement('atlas-box');
    wrap.setAttribute('name', `field-${key}`);
    const stack = document.createElement('atlas-stack');
    stack.setAttribute('direction', 'row');
    stack.setAttribute('gap', 'sm');
    stack.setAttribute('align', 'center');

    const label = makeText(labelFor(key, schema), { variant: 'small' });
    stack.appendChild(label);

    const value = Boolean(current ?? schema.default ?? false);
    const btn = document.createElement('atlas-button');
    btn.setAttribute('name', `toggle-${key}`);
    btn.setAttribute('variant', value ? 'primary' : 'ghost');
    btn.setAttribute('size', 'sm');
    btn.setAttribute('aria-pressed', value ? 'true' : 'false');
    btn.textContent = value ? 'On' : 'Off';
    btn.addEventListener('click', () => {
      this._update(key, !value);
    });
    stack.appendChild(btn);

    wrap.appendChild(stack);
    return wrap;
  }

  private _renderEnumField(
    key: string,
    schema: JsonSchema,
    values: string[],
    current: unknown,
  ): HTMLElement {
    const wrap = document.createElement('atlas-box');
    wrap.setAttribute('name', `field-${key}`);
    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'xs');

    const label = makeText(labelFor(key, schema), { variant: 'small' });
    stack.appendChild(label);

    const row = document.createElement('atlas-stack');
    row.setAttribute('direction', 'row');
    row.setAttribute('gap', 'xs');
    row.setAttribute('wrap', '');
    const selected = current ?? schema.default ?? values[0];
    for (const v of values) {
      const btn = document.createElement('atlas-button');
      btn.setAttribute('name', `enum-${key}-${v || 'blank'}`);
      btn.setAttribute('variant', v === selected ? 'primary' : 'ghost');
      btn.setAttribute('size', 'sm');
      btn.setAttribute('aria-pressed', v === selected ? 'true' : 'false');
      btn.textContent = v === '' ? '(none)' : v;
      btn.addEventListener('click', () => this._update(key, v));
      row.appendChild(btn);
    }
    stack.appendChild(row);
    wrap.appendChild(stack);
    return wrap;
  }

  private _renderArrayField(key: string, schema: JsonSchema, current: unknown): HTMLElement {
    // Determine if items are primitives or objects.
    const items = schema.items;
    const arr = Array.isArray(current) ? (current as unknown[]) : [];
    const isPrimitive =
      items &&
      (items.type === 'string' || items.type === 'number' || items.type === 'integer');

    if (isPrimitive && items) {
      const wrap = document.createElement('atlas-box');
      wrap.setAttribute('name', `field-${key}`);
      const input = document.createElement('atlas-input');
      input.setAttribute('label', `${labelFor(key, schema)} (comma-separated)`);
      input.setAttribute('type', 'text');
      const text = arr.join(', ');
      input.setAttribute('value', text);
      queueMicrotask(() => {
        const inner = input.shadowRoot?.querySelector('input') as HTMLInputElement | null;
        if (inner && inner.value !== text) inner.value = text;
      });
      // Live comma-separated list preview: re-parse per keystroke so the
      // preview tracks typing (same rationale as the scalar fields).
      input.addEventListener('input', (e: Event) => {
        const detail = (e as CustomEvent<{ value?: string }>).detail;
        const raw = String(detail?.value ?? '').trim();
        if (!raw) return this._update(key, []);
        const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
        if (items.type === 'string') return this._update(key, parts);
        const nums = parts.map((p) => (items.type === 'integer' ? parseInt(p, 10) : Number(p)))
          .filter((n) => Number.isFinite(n));
        this._update(key, nums);
      });
      wrap.appendChild(input);
      return wrap;
    }

    // Fallback: JSON textarea.
    return this._renderObjectField(key, schema, arr);
  }

  private _renderObjectField(key: string, schema: JsonSchema, current: unknown): HTMLElement {
    const wrap = document.createElement('atlas-box');
    wrap.setAttribute('name', `field-${key}`);
    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'xs');

    const label = makeText(`${labelFor(key, schema)} (JSON)`, { variant: 'small' });
    stack.appendChild(label);

    // No atlas-textarea yet — use a plain textarea wrapped in an atlas-box.
    // Tracked as a follow-up; functional for now.
    const ta = document.createElement('textarea');
    ta.setAttribute('name', `json-${key}`);
    ta.rows = 4;
    ta.style.cssText = 'width:100%;font-family:var(--atlas-font-mono);font-size:var(--atlas-font-size-sm);padding:var(--atlas-space-sm);border:1px solid var(--atlas-color-border);border-radius:var(--atlas-radius-md);background:var(--atlas-color-bg);color:var(--atlas-color-text);';
    ta.value = current == null ? '' : JSON.stringify(current, null, 2);
    ta.addEventListener('change', () => {
      const raw = ta.value.trim();
      if (!raw) {
        this._update(key, undefined);
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        this._update(key, parsed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const existing = wrap.querySelector('.local-error');
        if (existing) existing.remove();
        const emsg = makeText(`Invalid JSON: ${msg}`, { variant: 'error' });
        emsg.className = 'local-error';
        wrap.appendChild(emsg);
      }
    });
    stack.appendChild(ta);
    wrap.appendChild(stack);
    return wrap;
  }

  private _update(key: string, value: unknown): void {
    if (value === undefined) {
      delete this._config[key];
    } else {
      this._config = { ...this._config, [key]: value };
    }
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      try {
        this.onChange?.(this._config);
      } catch (err) {
        this.setError(err instanceof Error ? err.message : String(err));
      }
    }, 150);
    // Re-render immediately to reflect toggle/enum active state, but
    // debounce the actual commit upstream.
    this._render();
  }
}

function labelFor(key: string, schema: JsonSchema): string {
  return schema.title ?? key;
}

function makeText(content: string, { variant }: { variant?: string } = {}): HTMLElement {
  const t = document.createElement('atlas-text');
  if (variant) t.setAttribute('variant', variant);
  t.textContent = content;
  return t;
}

function cloneDeep(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}

AtlasElement.define('page-editor-property-panel', PageEditorPropertyPanel);
