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
 * Invariant assertion for "I just constructed/indexed this; the access cannot
 * fail" patterns. Throws with a named invariant rather than returning
 * `undefined` and surprising the caller far downstream. Keeps the call site
 * free of `!` non-null assertions.
 */
function must<T>(v: T | null | undefined, invariant: string): T {
    if (v == null) {
        throw new Error(`Invariant violation: ${invariant}`);
    }
    return v;
}
/**
 * Wrap a caller-provided handler in an `EventListener` adapter so it can
 * be passed to `addEventListener` without an unsafe cast. The `html`
 * template tag normalises every authored handler into `(ev: Event) =>
 * unknown` at push time — the DOM API erases handler subtype variance
 * down to a single union, so we adapt at this one boundary.
 */
function asEventListener(fn: (ev: Event) => unknown): EventListener {
    return function (ev: Event): void {
        fn(ev);
    };
}
/**
 * Adapt a template-author handler — whose authored signature could be
 * zero-arg, `(ev: Event)`, `(ev: MouseEvent)`, or any other DOM Event
 * subtype — into a uniform `(ev: Event) => unknown`. We dispatch via
 * `Reflect.apply` so no static cast forges variance; the DOM does the
 * same thing at runtime when it calls a listener.
 *
 * Input is the `HtmlValue` function shape `(...args: never[]) => unknown`,
 * the bottom-function type produced by narrowing the union via
 * `typeof === 'function'`. Reflect.apply takes its target through a
 * runtime check (it throws if not callable) rather than a static cast.
 */
function normalizeHandler(fn: (...args: never[]) => unknown): (ev: Event) => unknown {
    return function (ev: Event): unknown {
        return Reflect.apply(fn, null, [ev]);
    };
}
/**
 * Set an arbitrary string-named property on a DOM node from a `.prop=`
 * binding. Uses `Reflect.set` so we never need to cast the Element into a
 * synthetic index-signature type — the reflection API takes the property
 * key as a string and accepts any value, which is exactly the runtime
 * shape of `el.foo = value` in vanilla DOM JS.
 */
function setNodeProperty(node: Element, key: string, value: unknown): void {
    Reflect.set(node, key, value);
}
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
type EventAttrBinding = {
    type: 'attr';
    attrKind: 'event';
    id: string;
    attrName: string;
    /**
     * Normalised to a single-arg `(ev: Event) => unknown` adapter at the
     * push site so the dispatch loop can pass it to `addEventListener`
     * directly. The authored shape (`(...args: never[]) => unknown`) is
     * the bottom-function type from the `HtmlValue` union — uncallable in
     * strict-function-types mode without the adapter.
     */
    handler: (ev: Event) => unknown;
};
type PropAttrBinding = {
    type: 'attr';
    attrKind: 'prop';
    id: string;
    attrName: string;
    /**
     * `.prop=` bindings pass the value through unchanged — assigning a
     * function as a property (e.g. `el.onclick = handler`) must preserve
     * identity, so we keep the original reference rather than wrapping.
     */
    value: unknown;
};
type AttrBinding = EventAttrBinding | PropAttrBinding;
type Binding = NodeBinding | AttrBinding;
export type HtmlValue = DocumentFragment | HTMLElement | ((...args: never[]) => unknown) | readonly HtmlValue[] | string | number | boolean | null | undefined;
/**
 * Tagged template literal for HTML rendering.
 */
export function html(strings: TemplateStringsArray, ...values: readonly HtmlValue[]): DocumentFragment {
    const parts: string[] = [];
    const bindings: Binding[] = [];
    for (let i = 0; i < strings.length; i++) {
        parts.push(must(strings[i], `template strings[${i}] present`));
        if (i < values.length) {
            const value = values[i];
            if (value instanceof DocumentFragment || value instanceof HTMLElement) {
                const id = `${MARKER}node_${i}`;
                parts.push(`<span data-atlas-slot="${id}"></span>`);
                bindings.push({ type: 'node', id, value });
            }
            else if (typeof value === 'function') {
                const preceding = parts.join('');
                const attrMatch = preceding.match(/\s([@.]\w+)="?$/);
                if (attrMatch) {
                    const id = `${MARKER}fn_${i}`;
                    parts.push(id);
                    const attrName = must(attrMatch[1], 'event/prop attr capture group present');
                    if (attrName.startsWith('@')) {
                        bindings.push({
                            type: 'attr',
                            attrKind: 'event',
                            id,
                            attrName,
                            handler: normalizeHandler(value),
                        });
                    }
                    else {
                        // `.prop=` binding: store the original function reference so
                        // assignment via `el.prop = value` preserves identity.
                        bindings.push({
                            type: 'attr',
                            attrKind: 'prop',
                            id,
                            attrName,
                            value,
                        });
                    }
                }
                else {
                    parts.push(escapeHtml(String(value)));
                }
            }
            else if (Array.isArray(value)) {
                for (const item of value) {
                    if (item instanceof DocumentFragment || item instanceof HTMLElement) {
                        const id = `${MARKER}node_${i}_${Math.random().toString(36).slice(2, 6)}`;
                        parts.push(`<span data-atlas-slot="${id}"></span>`);
                        bindings.push({ type: 'node', id, value: item });
                    }
                    else {
                        parts.push(escapeHtml(String(item ?? '')));
                    }
                }
            }
            else {
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
    // Cache the element walk per fragment — every attr binding scans the
    // same node set, and `querySelectorAll('*')` is `O(n)` (vs an `O(n²)`
    // re-walk per binding via TreeWalker). Returns a NodeListOf<Element>,
    // so no narrowing cast from Node is needed at the call site.
    const elements: NodeListOf<Element> | null = bindings.some(function (b) {
        return b.type === 'attr';
    })
        ? fragment.querySelectorAll('*')
        : null;
    for (const binding of bindings) {
        if (binding.type !== 'attr' || !elements)
            continue;
        for (const node of elements) {
            for (const attr of [...node.attributes]) {
                if (attr.value !== binding.id)
                    continue;
                if (binding.attrKind === 'event') {
                    const eventMatch = attr.name.match(EVENT_ATTR_RE);
                    if (eventMatch) {
                        const eventName = must(eventMatch[1], '@event attr capture group present');
                        node.addEventListener(eventName, asEventListener(binding.handler));
                        node.removeAttribute(attr.name);
                    }
                }
                else {
                    const propMatch = attr.name.match(PROP_ATTR_RE);
                    if (propMatch) {
                        const propName = must(propMatch[1], '.prop attr capture group present');
                        setNodeProperty(node, propName, binding.value);
                        node.removeAttribute(attr.name);
                    }
                }
            }
        }
    }
    return fragment;
}
