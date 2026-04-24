import { AtlasElement } from '@atlas/core';

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
 * Usage:
 *   <atlas-form-field label="Email" description="We never share this." required>
 *     <atlas-input type="email" name="email"></atlas-input>
 *   </atlas-form-field>
 *
 *   <atlas-form-field label="Password" error="At least 8 characters.">
 *     <atlas-input type="password"></atlas-input>
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

  private _fieldId = `atlas-field-${Math.random().toString(36).slice(2, 8)}`;
  private _descId = `${this._fieldId}-desc`;
  private _errId = `${this._fieldId}-err`;

  override connectedCallback(): void {
    super.connectedCallback();
    this._render();
  }

  override attributeChangedCallback(): void {
    this._render();
  }

  private _render(): void {
    const label = this.getAttribute('label');
    const description = this.getAttribute('description');
    const error = this.getAttribute('error');
    const required = this.hasAttribute('required');

    const existing = Array.from(this.children).find(
      (c) => !c.matches('[data-atlas-field-part]'),
    ) as HTMLElement | undefined;

    for (const part of Array.from(this.querySelectorAll('[data-atlas-field-part]'))) {
      part.remove();
    }

    if (label) {
      const lbl = document.createElement('label');
      lbl.setAttribute('data-atlas-field-part', 'label');
      lbl.setAttribute('for', this._fieldId);
      lbl.innerHTML = required
        ? `${escapeText(label)}<span aria-hidden="true" data-atlas-field-required>&nbsp;*</span>`
        : escapeText(label);
      this.insertBefore(lbl, this.firstChild);
    }

    if (description) {
      const desc = document.createElement('span');
      desc.setAttribute('data-atlas-field-part', 'description');
      desc.id = this._descId;
      desc.textContent = description;
      this.appendChild(desc);
    }

    if (error) {
      const err = document.createElement('span');
      err.setAttribute('data-atlas-field-part', 'error');
      err.id = this._errId;
      err.setAttribute('role', 'alert');
      err.textContent = error;
      this.appendChild(err);
    }

    if (existing) {
      if (!existing.id) existing.id = this._fieldId;
      const describedBy = [
        description ? this._descId : null,
        error ? this._errId : null,
      ]
        .filter(Boolean)
        .join(' ');
      if (describedBy) existing.setAttribute('aria-describedby', describedBy);
      else existing.removeAttribute('aria-describedby');
      if (error) existing.setAttribute('aria-invalid', 'true');
      else existing.removeAttribute('aria-invalid');
      if (required) existing.setAttribute('aria-required', 'true');
      else existing.removeAttribute('aria-required');
    }

    if (error) this.setAttribute('invalid', '');
    else this.removeAttribute('invalid');
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

AtlasElement.define('atlas-form-field', AtlasFormField);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-form-field': AtlasFormField;
  }
}
