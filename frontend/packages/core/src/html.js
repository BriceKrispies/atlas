/**
 * Tagged template literal for safe HTML rendering.
 *
 * Features:
 * - Auto-escapes interpolated values (XSS prevention)
 * - Event binding via @click, @input, etc.
 * - Property binding via .prop
 * - Returns a DocumentFragment for efficient DOM insertion
 *
 * Usage:
 *   html`<button @click=${handler} data-testid="${id}">
 *     ${userInput}
 *   </button>`
 */

const EVENT_ATTR_RE = /^@(\w+)$/;
const PROP_ATTR_RE = /^\.(\w+)$/;

/**
 * Escape a string for safe HTML insertion.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Marker prefix for dynamic values in the template.
 * Uses a random suffix to avoid collisions with user content.
 */
const MARKER = `__atlas_${Math.random().toString(36).slice(2, 8)}__`;

/**
 * Tagged template literal for HTML rendering.
 * @param {TemplateStringsArray} strings
 * @param {...*} values
 * @returns {DocumentFragment}
 */
export function html(strings, ...values) {
  const parts = [];
  const bindings = [];

  for (let i = 0; i < strings.length; i++) {
    parts.push(strings[i]);

    if (i < values.length) {
      const value = values[i];

      if (value instanceof DocumentFragment || value instanceof HTMLElement) {
        // DOM node — insert placeholder and replace later
        const id = `${MARKER}node_${i}`;
        parts.push(`<span data-atlas-slot="${id}"></span>`);
        bindings.push({ type: 'node', id, value });
      } else if (typeof value === 'function') {
        // Check if we're in an attribute context like @click= or .prop=
        const preceding = parts.join('');
        const attrMatch = preceding.match(/\s([@.]\w+)="?$/);
        if (attrMatch) {
          const id = `${MARKER}fn_${i}`;
          parts.push(id);
          bindings.push({ type: 'attr', id, attrName: attrMatch[1], value });
        } else {
          // Function outside attribute context — escape the toString
          parts.push(escapeHtml(String(value)));
        }
      } else if (Array.isArray(value)) {
        // Array of fragments or strings
        for (const item of value) {
          if (item instanceof DocumentFragment || item instanceof HTMLElement) {
            const id = `${MARKER}node_${i}_${Math.random().toString(36).slice(2, 6)}`;
            parts.push(`<span data-atlas-slot="${id}"></span>`);
            bindings.push({ type: 'node', id, value: item });
          } else {
            parts.push(escapeHtml(String(item ?? '')));
          }
        }
      } else {
        // Primitive — escape it
        parts.push(escapeHtml(String(value ?? '')));
      }
    }
  }

  const markup = parts.join('');
  const template = document.createElement('template');
  template.innerHTML = markup;
  const fragment = template.content;

  // Process node bindings — replace placeholder spans with real DOM
  for (const binding of bindings) {
    if (binding.type === 'node') {
      const slot = fragment.querySelector(`[data-atlas-slot="${binding.id}"]`);
      if (slot) {
        slot.replaceWith(binding.value);
      }
    }
  }

  // Process event and property bindings
  for (const binding of bindings) {
    if (binding.type === 'attr') {
      const selector = `[${binding.attrName}="${binding.id}"]`;
      // The attr might be in the format @click="marker" — need to find by marker in attributes
      const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        for (const attr of [...node.attributes]) {
          if (attr.value === binding.id) {
            const eventMatch = attr.name.match(EVENT_ATTR_RE);
            const propMatch = attr.name.match(PROP_ATTR_RE);

            if (eventMatch) {
              node.addEventListener(eventMatch[1], binding.value);
              node.removeAttribute(attr.name);
            } else if (propMatch) {
              node[propMatch[1]] = binding.value;
              node.removeAttribute(attr.name);
            }
          }
        }
      }
    }
  }

  return fragment;
}
