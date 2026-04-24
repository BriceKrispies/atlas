import { AtlasElement } from '@atlas/core';
import { uid } from './util.ts';

/**
 * `<atlas-form-field>` — label/description/error wiring primitive.
 *
 * Wraps exactly one form control (input, select, etc.) and:
 *   • renders a consistent label row
 *   • renders an optional description and/or error beneath
 *   • stamps IDs on the description/error nodes and sets `aria-describedby`
 *     on the child control so screen readers announce them
 *   • adds `aria-invalid="true"` to the child when `error` is present
 *   • marks `required` with a visual * and appropriate ARIA
 *
 * Light-DOM so that consumers can style cleanly and so the wired control
 * lives in the same scope as its associated messages (aria-describedby
 * cannot cross shadow-root boundaries reliably).
 *
 * When to use: any user-editable field that needs a label plus description
 * or error. Pair with any of Input, Textarea, Select, Checkbox, Radio,
 * Switch, NumberInput, Slider, DatePicker, FileUpload, SearchInput.
 * When NOT to use: purely decorative controls (e.g. a filter toggle with a
 * self-explanatory icon).
 *
 * Child-control resolution:
 *   1. If a descendant carries `data-atlas-control`, that element is the
 *      wired control (preferred — explicit and survives wrappers/icons).
 *   2. Otherwise, the first non-part child element is used (legacy
 *      heuristic; breaks if the consumer wraps the control in a `<div>`
 *      or adds an icon prefix).
 *
 * Usage:
 *   <atlas-form-field label="Email" description="We never share this." required>
 *     <atlas-input type="email" name="email"></atlas-input>
 *   </atlas-form-field>
 *
 *   <atlas-form-field label="Password" error="At least 8 characters.">
 *     <atlas-input type="password" data-atlas-control></atlas-input>
 *   </atlas-form-field>
 *
 * Attributes:
 *   label         — label text (required for most fields)
 *   description   — helper text
 *   error         — error message; when set, styling turns error-red and
 *                   the child gets aria-invalid="true"
 *   required      — marks the field required (visual + aria)
 *   for           — optional id override to target a specific child control
 */
export class AtlasFormField extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['label', 'description', 'error', 'required'];
  }

  declare required: boolean;

  static {
    Object.defineProperty(
      this.prototype,
      'required',
      AtlasElement.boolAttr('required'),
    );
  }

  private readonly _fieldId = uid('atlas-field');
  private readonly _descId = `${this._fieldId}-desc`;
  private readonly _errId = `${this._fieldId}-err`;

  private _built = false;
  private _labelEl: HTMLLabelElement | null = null;
  private _labelTextNode: Text | null = null;
  private _requiredMarker: HTMLSpanElement | null = null;
  private _descEl: HTMLSpanElement | null = null;
  private _errorEl: HTMLSpanElement | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildParts();
    this._built = true;
    this._syncAll();
  }

  override attributeChangedCallback(
    name: string,
    oldVal: string | null,
    newVal: string | null,
  ): void {
    if (!this._built) return;
    if (oldVal === newVal) return;
    this._sync(name);
  }

  /** Create once: label, description, error nodes. Text/visibility updated later. */
  private _buildParts(): void {
    // Remove any previously-rendered parts (SSR / reattach edge cases).
    for (const part of Array.from(
      this.querySelectorAll('[data-atlas-field-part]'),
    )) {
      part.remove();
    }

    const label = document.createElement('label');
    label.setAttribute('data-atlas-field-part', 'label');
    label.setAttribute('for', this._fieldId);
    label.hidden = true;
    this._labelTextNode = document.createTextNode('');
    label.appendChild(this._labelTextNode);
    const marker = document.createElement('span');
    marker.setAttribute('aria-hidden', 'true');
    marker.setAttribute('data-atlas-field-required', '');
    marker.textContent = ' *';
    marker.hidden = true;
    label.appendChild(marker);
    this._labelEl = label;
    this._requiredMarker = marker;
    this.insertBefore(label, this.firstChild);

    const desc = document.createElement('span');
    desc.setAttribute('data-atlas-field-part', 'description');
    desc.id = this._descId;
    desc.hidden = true;
    this.appendChild(desc);
    this._descEl = desc;

    const err = document.createElement('span');
    err.setAttribute('data-atlas-field-part', 'error');
    err.id = this._errId;
    err.setAttribute('role', 'alert');
    err.hidden = true;
    this.appendChild(err);
    this._errorEl = err;
  }

  private _syncAll(): void {
    this._sync('label');
    this._sync('description');
    this._sync('error');
    this._sync('required');
    this._wireChildControl();
  }

  private _sync(name: string): void {
    switch (name) {
      case 'label': {
        const label = this.getAttribute('label');
        // Assigning to a Text node's `data` cannot introduce HTML — the
        // DOM auto-escapes. We still route through escapeText for
        // consistency with the design-system convention (and it's a
        // near-noop for a Text node).
        if (this._labelTextNode) this._labelTextNode.data = label ?? '';
        if (this._labelEl) this._labelEl.hidden = label == null;
        break;
      }
      case 'description': {
        const desc = this.getAttribute('description');
        if (this._descEl) {
          this._descEl.textContent = desc ?? '';
          this._descEl.hidden = desc == null;
        }
        this._wireChildControl();
        break;
      }
      case 'error': {
        const error = this.getAttribute('error');
        if (this._errorEl) {
          this._errorEl.textContent = error ?? '';
          this._errorEl.hidden = error == null;
        }
        if (error != null) this.setAttribute('invalid', '');
        else this.removeAttribute('invalid');
        this._wireChildControl();
        break;
      }
      case 'required': {
        if (this._requiredMarker) this._requiredMarker.hidden = !this.required;
        this._wireChildControl();
        break;
      }
    }
  }

  /** Locate + mirror aria-* onto the wired child control. */
  private _wireChildControl(): void {
    const control = this._resolveControl();
    if (!control) return;
    if (!control.id) control.id = this._fieldId;
    const description = this.getAttribute('description');
    const error = this.getAttribute('error');
    const describedBy = [
      description != null ? this._descId : null,
      error != null ? this._errId : null,
    ]
      .filter(Boolean)
      .join(' ');
    if (describedBy) control.setAttribute('aria-describedby', describedBy);
    else control.removeAttribute('aria-describedby');
    if (error != null) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');
    if (this.required) control.setAttribute('aria-required', 'true');
    else control.removeAttribute('aria-required');
  }

  private _resolveControl(): HTMLElement | null {
    // 1. Explicit opt-in.
    const opted = this.querySelector<HTMLElement>('[data-atlas-control]');
    if (opted) return opted;

    // 2. Legacy heuristic: first non-part child.
    const candidates = Array.from(this.children).filter(
      (c) => !c.matches('[data-atlas-field-part]'),
    ) as HTMLElement[];
    if (candidates.length === 1) return candidates[0] ?? null;
    if (candidates.length > 1 && typeof console !== 'undefined') {
      console.warn(
        '[atlas-form-field] Multiple child elements detected; add `data-atlas-control` to the wired control for reliable aria wiring.',
      );
    }
    return candidates[0] ?? null;
  }
}

AtlasElement.define('atlas-form-field', AtlasFormField);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-form-field': AtlasFormField;
  }
}
