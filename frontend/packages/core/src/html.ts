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

function escapeHtml(str: string): string {
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

type NodeBinding = {
  type: 'node';
  id: string;
  value: DocumentFragment | HTMLElement;
};

type AttrBinding = {
  type: 'attr';
  id: string;
  attrName: string;
  value: unknown;
};

type Binding = NodeBinding | AttrBinding;

export type HtmlValue =
  | DocumentFragment
  | HTMLElement
  | ((...args: never[]) => unknown)
  | readonly HtmlValue[]
  | string
  | number
  | boolean
  | null
  | undefined;

/**
 * Tagged template literal for HTML rendering.
 */
export function html(
  strings: TemplateStringsArray,
  ...values: readonly HtmlValue[]
): DocumentFragment {
  const parts: string[] = [];
  const bindings: Binding[] = [];

  for (let i = 0; i < strings.length; i++) {
    parts.push(strings[i]!);

    if (i < values.length) {
      const value = values[i];

      if (value instanceof DocumentFragment || value instanceof HTMLElement) {
        const id = `${MARKER}node_${i}`;
        parts.push(`<span data-atlas-slot="${id}"></span>`);
        bindings.push({ type: 'node', id, value });
      } else if (typeof value === 'function') {
        const preceding = parts.join('');
        const attrMatch = preceding.match(/\s([@.]\w+)="?$/);
        if (attrMatch) {
          const id = `${MARKER}fn_${i}`;
          parts.push(id);
          bindings.push({ type: 'attr', id, attrName: attrMatch[1]!, value });
        } else {
          parts.push(escapeHtml(String(value)));
        }
      } else if (Array.isArray(value)) {
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
        parts.push(escapeHtml(String(value ?? '')));
      }
    }
  }

  const markup = parts.join('');
  const template = document.createElement('template');
  template.innerHTML = markup;
  const fragment = template.content;

  for (const binding of bindings) {
    if (binding.type === 'node') {
      const slot = fragment.querySelector(`[data-atlas-slot="${binding.id}"]`);
      if (slot) {
        slot.replaceWith(binding.value);
      }
    }
  }

  for (const binding of bindings) {
    if (binding.type === 'attr') {
      const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT);
      let node: Element | null;
      while ((node = walker.nextNode() as Element | null)) {
        for (const attr of [...node.attributes]) {
          if (attr.value === binding.id) {
            const eventMatch = attr.name.match(EVENT_ATTR_RE);
            const propMatch = attr.name.match(PROP_ATTR_RE);

            if (eventMatch) {
              node.addEventListener(
                eventMatch[1]!,
                binding.value as EventListenerOrEventListenerObject,
              );
              node.removeAttribute(attr.name);
            } else if (propMatch) {
              (node as unknown as Record<string, unknown>)[propMatch[1]!] = binding.value;
              node.removeAttribute(attr.name);
            }
          }
        }
      }
    }
  }

  return fragment;
}
