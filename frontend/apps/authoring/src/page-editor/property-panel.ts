/**
 * <page-editor-property-panel> — schema-driven property editor.
 *
 * Given a widget manifest's configSchema and the current instance config,
 * renders a form whose controls map 1:1 to JSON Schema properties. A
 * debounced onChange callback propagates edits back to the shell, which
 * commits them via `contentPageEl.editor.update({ instanceId, config })`.
 *
 * Stage 4 adds support for the `x-atlas-*` extension vocabulary documented
 * in `editor-widgets/_schema-extensions.md`:
 *   - `x-atlas-section`        — group fields into collapsible sections.
 *   - `x-atlas-section-order`  — section render order, labels, defaultOpen.
 *   - `x-atlas-when`           — single-field equality conditional visibility.
 *   - `x-atlas-control`        — control-type override (textarea, csv, color).
 *
 * Public contract preserved (the shell still consumes this element directly
 * today): `configure({ widgetId, instanceId, config, schema })`, `clear()`,
 * `setError(reason)`, `onChange` callback. Field-only render is exposed via
 * `setVisibleFields(...)` for the multi-select inspector path.
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

interface SectionDescriptor {
  id: string;
  label: string;
  defaultOpen: boolean;
}

interface WhenClause {
  field: string;
  equals: unknown;
}

const DEFAULT_SECTION_ID = '__default__';
const DEFAULT_SECTION_LABEL = 'General';

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
  /** When non-null, only fields whose key is in this set are rendered. */
  private _visibleFieldsAllowList: Set<string> | null = null;
  /**
   * Open/closed state for sections, keyed by section id. Populated lazily
   * from the schema on first render; mutated by the section-toggle button.
   * Survives `configure()` calls so a user that opened "Advanced" stays
   * landed there as they switch between sibling widgets.
   */
  private _sectionOpen: Map<string, boolean> = new Map();
  /** Suppress header (title + subtitle) — used by the inspector wrapper. */
  private _headerSuppressed = false;

  onChange: (config: PropertyConfig) => void = () => {};
  /** Optional hook fired when the user toggles a section (open or close). */
  onSectionToggle: (section: string, open: boolean) => void = () => {};

  /**
   * Populate the panel with a widget's current config + schema.
   */
  configure({ widgetId, instanceId, config, schema }: PropertyPanelConfigureArgs): void {
    this._widgetId = widgetId;
    this._instanceId = instanceId;
    this._config = cloneDeep(config ?? {}) as PropertyConfig;
    this._schema = schema;
    this._error = null;
    this._seedSectionState(schema);
    if (this.isConnected) this._render();
  }

  clear(): void {
    this._widgetId = null;
    this._instanceId = null;
    this._config = {};
    this._schema = null;
    this._error = null;
    this._visibleFieldsAllowList = null;
    if (this.isConnected) this._render();
  }

  /**
   * Limit the rendered field set to a given allow-list (used by the
   * multi-select inspector to render only the intersection of shared
   * fields). Pass `null` to clear and render all schema fields.
   */
  setVisibleFields(fields: string[] | null): void {
    this._visibleFieldsAllowList = fields ? new Set(fields) : null;
    if (this.isConnected) this._render();
  }

  /**
   * Hide the inline title + subtitle so a wrapper element can render its
   * own header.
   */
  setHeaderSuppressed(suppressed: boolean): void {
    this._headerSuppressed = suppressed;
    if (this.isConnected) this._render();
  }

  /** Programmatically open or close a section. */
  setSectionOpen(section: string, open: boolean): void {
    this._sectionOpen.set(section, open);
    if (this.isConnected) this._render();
  }

  /** Read-only view of section open state — used by the wrapper test reader. */
  getSectionState(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const [k, v] of this._sectionOpen) out[k] = v;
    return out;
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

  // ---- section / extension helpers ----

  private _seedSectionState(schema: JsonSchema | null): void {
    if (!schema) return;
    const order = readSectionOrder(schema);
    const used = new Set<string>();
    // Walk explicit order first.
    for (const desc of order) {
      used.add(desc.id);
      if (!this._sectionOpen.has(desc.id)) this._sectionOpen.set(desc.id, desc.defaultOpen);
    }
    // Discover any other sections referenced by properties — defaults closed.
    const props = schema.properties ?? {};
    for (const propSchema of Object.values(props)) {
      const sid = (propSchema as JsonSchema)['x-atlas-section'] as string | undefined;
      const id = sid && !used.has(sid) ? sid : sid;
      if (id && !this._sectionOpen.has(id)) this._sectionOpen.set(id, false);
    }
    // Ensure the default bucket exists (open by default).
    if (!this._sectionOpen.has(DEFAULT_SECTION_ID)) {
      this._sectionOpen.set(DEFAULT_SECTION_ID, true);
    }
  }

  private _resolveSections(schema: JsonSchema): SectionDescriptor[] {
    const order = readSectionOrder(schema);
    const props = schema.properties ?? {};
    const referenced = new Set<string>();
    let hasDefault = false;
    for (const propSchema of Object.values(props)) {
      const sid = (propSchema as JsonSchema)['x-atlas-section'] as string | undefined;
      if (sid) referenced.add(sid);
      else hasDefault = true;
    }
    const declared = new Set(order.map((d) => d.id));
    const out: SectionDescriptor[] = [];
    if (hasDefault) {
      out.push({ id: DEFAULT_SECTION_ID, label: DEFAULT_SECTION_LABEL, defaultOpen: true });
    }
    for (const desc of order) out.push(desc);
    // Append any referenced-but-not-declared sections (alphabetical).
    const extras = [...referenced].filter((id) => !declared.has(id)).sort();
    for (const id of extras) {
      out.push({ id, label: prettyLabel(id), defaultOpen: false });
    }
    return out;
  }

  private _isFieldVisible(propSchema: JsonSchema): boolean {
    const when = propSchema['x-atlas-when'] as WhenClause | undefined;
    if (!when || typeof when !== 'object' || typeof when.field !== 'string') return true;
    const dependencyValue = this._config?.[when.field];
    if (Array.isArray(when.equals)) {
      return when.equals.some((v) => v === dependencyValue);
    }
    return when.equals === dependencyValue;
  }

  // ---- rendering ----

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

    if (!this._headerSuppressed) {
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
    }

    const props = this._schema.properties ?? {};
    const sections = this._resolveSections(this._schema);

    // Bucket fields by section, preserving the schema's property iteration
    // order within each bucket.
    const buckets = new Map<string, Array<[string, JsonSchema]>>();
    for (const desc of sections) buckets.set(desc.id, []);
    for (const [key, propSchema] of Object.entries(props)) {
      if (this._visibleFieldsAllowList && !this._visibleFieldsAllowList.has(key)) continue;
      const sid =
        ((propSchema as JsonSchema)['x-atlas-section'] as string | undefined) ?? DEFAULT_SECTION_ID;
      if (!buckets.has(sid)) {
        // Section referenced but not in `sections` — append on the fly.
        buckets.set(sid, []);
        sections.push({ id: sid, label: prettyLabel(sid), defaultOpen: false });
      }
      buckets.get(sid)!.push([key, propSchema as JsonSchema]);
    }

    for (const desc of sections) {
      const bucket = buckets.get(desc.id) ?? [];
      if (bucket.length === 0) continue;
      const sectionEl = this._renderSection(desc, bucket);
      if (sectionEl) stack.appendChild(sectionEl);
    }

    if (this._error) {
      const err = makeText(this._error, { variant: 'error' });
      err.setAttribute('name', 'inspector-error');
      stack.appendChild(err);
    }

    this.appendChild(stack);
  }

  private _renderSection(
    desc: SectionDescriptor,
    fields: Array<[string, JsonSchema]>,
  ): HTMLElement | null {
    const open = this._sectionOpen.get(desc.id) ?? desc.defaultOpen;

    const section = document.createElement('atlas-stack');
    section.setAttribute('gap', 'xs');
    section.setAttribute('name', `settings-group-${desc.id}`);
    section.setAttribute('data-group', desc.id);
    section.setAttribute('data-open', open ? 'true' : 'false');

    const toggle = document.createElement('atlas-button');
    toggle.setAttribute('name', `settings-group-toggle-${desc.id}`);
    toggle.setAttribute('data-group', desc.id);
    toggle.setAttribute('variant', 'ghost');
    toggle.setAttribute('size', 'sm');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.textContent = `${open ? '▾' : '▸'} ${desc.label}`;
    toggle.addEventListener('click', () => {
      const next = !(this._sectionOpen.get(desc.id) ?? desc.defaultOpen);
      this._sectionOpen.set(desc.id, next);
      try {
        this.onSectionToggle?.(desc.id, next);
      } catch {
        /* ignore — UI must keep working */
      }
      this._render();
    });
    section.appendChild(toggle);

    if (open) {
      const body = document.createElement('atlas-stack');
      body.setAttribute('gap', 'sm');
      body.setAttribute('data-group-body', desc.id);
      let appended = 0;
      for (const [key, propSchema] of fields) {
        if (!this._isFieldVisible(propSchema)) continue;
        const field = this._renderField(key, propSchema);
        if (field) {
          body.appendChild(field);
          appended++;
        }
      }
      // Skip rendering the body when every field is hidden by `x-atlas-when`.
      if (appended > 0) section.appendChild(body);
    }

    return section;
  }

  private _renderField(key: string, schema: JsonSchema): HTMLElement | null {
    const control = schema['x-atlas-control'] as string | undefined;
    const type = schema.type;
    const enumValues = Array.isArray(schema.enum) ? (schema.enum as unknown[]) : null;
    const current = this._config?.[key];

    // Honor explicit `x-atlas-control` overrides first.
    if (control === 'textarea' && type === 'string') {
      return this._renderTextareaField(key, schema, current);
    }
    if (control === 'color' && type === 'string') {
      return this._renderColorField(key, schema, current);
    }
    if (control === 'csv' && type === 'string') {
      return this._renderCsvStringField(key, schema, current);
    }
    if (control === 'select' && enumValues && type === 'string') {
      return this._renderEnumField(key, schema, enumValues as string[], current);
    }
    if (control === 'chips' && enumValues && type === 'string') {
      return this._renderEnumField(key, schema, enumValues as string[], current);
    }

    // Fall back to the JSON-type heuristic.
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
    queueMicrotask(() => {
      const inner = input.shadowRoot?.querySelector('input') as HTMLInputElement | null;
      if (inner && inner.value !== String(value)) inner.value = String(value);
    });
    input.addEventListener('input', (e: Event) => {
      const detail = (e as CustomEvent<{ value?: string }>).detail;
      this._update(key, detail?.value ?? '');
    });
    wrap.appendChild(input);
    return wrap;
  }

  private _renderTextareaField(
    key: string,
    schema: JsonSchema,
    current: unknown,
  ): HTMLElement {
    const wrap = document.createElement('atlas-box');
    wrap.setAttribute('name', `field-${key}`);
    wrap.setAttribute('data-control', 'textarea');
    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'xs');

    const label = makeText(labelFor(key, schema), { variant: 'small' });
    stack.appendChild(label);

    const ta = document.createElement('textarea');
    ta.setAttribute('name', `textarea-${key}`);
    ta.rows = 4;
    ta.style.cssText =
      'width:100%;font-family:var(--atlas-font-body);font-size:var(--atlas-font-size-sm);padding:var(--atlas-space-sm);border:1px solid var(--atlas-color-border);border-radius:var(--atlas-radius-md);background:var(--atlas-color-bg);color:var(--atlas-color-text);min-height:88px;';
    const value = current ?? schema.default ?? '';
    ta.value = String(value);
    ta.addEventListener('input', () => {
      this._update(key, ta.value);
    });
    stack.appendChild(ta);
    wrap.appendChild(stack);
    return wrap;
  }

  private _renderColorField(key: string, schema: JsonSchema, current: unknown): HTMLElement {
    const wrap = document.createElement('atlas-box');
    wrap.setAttribute('name', `field-${key}`);
    wrap.setAttribute('data-control', 'color');
    const input = document.createElement('atlas-input');
    input.setAttribute('label', labelFor(key, schema));
    input.setAttribute('type', 'color');
    const value = current ?? schema.default ?? '';
    input.setAttribute('value', String(value));
    queueMicrotask(() => {
      const inner = input.shadowRoot?.querySelector('input') as HTMLInputElement | null;
      if (inner && inner.value !== String(value) && String(value) !== '') {
        inner.value = String(value);
      }
    });
    input.addEventListener('input', (e: Event) => {
      const detail = (e as CustomEvent<{ value?: string }>).detail;
      this._update(key, detail?.value ?? '');
    });
    wrap.appendChild(input);
    return wrap;
  }

  /**
   * `x-atlas-control: 'csv'` for a string-typed field. The model value is a
   * comma-separated string (per the extension doc); we render an input plus
   * a chip-style preview so the user sees how their input parses.
   */
  private _renderCsvStringField(
    key: string,
    schema: JsonSchema,
    current: unknown,
  ): HTMLElement {
    const wrap = document.createElement('atlas-box');
    wrap.setAttribute('name', `field-${key}`);
    wrap.setAttribute('data-control', 'csv');
    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'xs');

    const input = document.createElement('atlas-input');
    input.setAttribute('label', labelFor(key, schema));
    input.setAttribute('type', 'text');
    const value = String(current ?? schema.default ?? '');
    input.setAttribute('value', value);
    queueMicrotask(() => {
      const inner = input.shadowRoot?.querySelector('input') as HTMLInputElement | null;
      if (inner && inner.value !== value) inner.value = value;
    });

    const chips = document.createElement('atlas-stack');
    chips.setAttribute('direction', 'row');
    chips.setAttribute('gap', 'xs');
    chips.setAttribute('wrap', '');
    chips.setAttribute('data-csv-chips', '');
    const renderChips = (raw: string): void => {
      chips.textContent = '';
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
      for (const part of parts) {
        const chip = document.createElement('atlas-text');
        chip.setAttribute('variant', 'small');
        chip.style.cssText =
          'padding:0 var(--atlas-space-xs);border:1px solid var(--atlas-color-border);border-radius:var(--atlas-radius-sm);background:var(--atlas-color-surface);';
        chip.textContent = part;
        chips.appendChild(chip);
      }
    };
    renderChips(value);

    input.addEventListener('input', (e: Event) => {
      const detail = (e as CustomEvent<{ value?: string }>).detail;
      const raw = detail?.value ?? '';
      renderChips(raw);
      this._update(key, raw);
    });

    stack.appendChild(input);
    stack.appendChild(chips);
    wrap.appendChild(stack);
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

    return this._renderObjectField(key, schema, arr);
  }

  private _renderObjectField(key: string, schema: JsonSchema, current: unknown): HTMLElement {
    const wrap = document.createElement('atlas-box');
    wrap.setAttribute('name', `field-${key}`);
    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'xs');

    const label = makeText(`${labelFor(key, schema)} (JSON)`, { variant: 'small' });
    stack.appendChild(label);

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
    // Re-render immediately so toggles, enum highlights, and `x-atlas-when`
    // dependent fields reflect the new state.
    this._render();
  }
}

function readSectionOrder(schema: JsonSchema): SectionDescriptor[] {
  const raw = schema['x-atlas-section-order'];
  if (!Array.isArray(raw)) return [];
  const out: SectionDescriptor[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { id?: unknown; label?: unknown; defaultOpen?: unknown };
    if (typeof e.id !== 'string' || e.id.length === 0) continue;
    out.push({
      id: e.id,
      label: typeof e.label === 'string' ? e.label : prettyLabel(e.id),
      defaultOpen: e.defaultOpen === true,
    });
  }
  return out;
}

function prettyLabel(id: string): string {
  if (!id) return id;
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]+/g, ' ');
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
