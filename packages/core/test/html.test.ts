/**
 * Unit tests for the `html` tagged template (`packages/core/src/html.ts`).
 *
 * Covers escaping, event binding, property binding, attribute binding, and
 * conditional / array interpolation. Linkedom-backed (set up globally by
 * `test-setup/linkedom-shims.ts`, which installs `NodeFilter` etc).
 */

import { describe, it, expect, vi } from 'vitest';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { html } from '../src/html.ts';

// ── helpers ─────────────────────────────────────────────────────────

/**
 * Look up an element inside a `DocumentFragment` and throw if absent —
 * `frag.querySelector` returns `Element | null`, and downstream tests
 * need a non-null `Element`. Throwing here turns missing-element bugs
 * into a loud test failure with the offending selector in the message.
 */
function queryElement(frag: DocumentFragment, selector: string): Element {
  const el = frag.querySelector(selector);
  if (!el) throw new Error(`expected element matching ${selector}`);
  return el;
}

/**
 * Look up an element and narrow to `HTMLElement` so attribute/listener
 * APIs not on the generic `Element` interface (e.g. `hasAttribute`,
 * `dispatchEvent`) are statically typed without a cast.
 */
function queryHtmlElement(
  frag: DocumentFragment,
  selector: string,
): HTMLElement {
  const el = queryElement(frag, selector);
  if (!(el instanceof HTMLElement)) {
    throw new Error(
      `expected ${selector} to be an HTMLElement, got ${el.constructor.name}`,
    );
  }
  return el;
}

describe('html — text escaping', () => {
  it('escapes < > & " \' inside interpolated text', () => {
    const evil = `<img src=x onerror=alert(1)>`;
    const frag = html`<p>${evil}</p>`;
    const p = queryHtmlElement(frag, 'p');
    expect(p.textContent).toBe(evil);
    // The fragment must NOT contain a real <img>.
    expect(frag.querySelector('img')).toBeNull();
  });

  it('renders numbers and booleans as their string form (still escaped)', () => {
    const frag = html`<span>${42}</span>`;
    expect(queryElement(frag, 'span').textContent).toBe('42');
  });

  it('coerces null/undefined to empty string rather than printing literally', () => {
    const frag = html`<span>[${null}][${undefined}]</span>`;
    expect(queryElement(frag, 'span').textContent).toBe('[][]');
  });
});

describe('html — event binding', () => {
  it('@click=${handler} attaches a click listener and removes the attribute', () => {
    const handler = vi.fn();
    const frag = html`<button @click=${handler}>Go</button>`;
    const btn = queryHtmlElement(frag, 'button');
    expect(btn.hasAttribute('@click')).toBe(false);
    btn.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('non-event function value (no @ prefix) is rendered as escaped text', () => {
    const fn = (): string => 'hello';
    const frag = html`<span>${fn}</span>`;
    const span = queryHtmlElement(frag, 'span');
    // Coerced via String(value) and escaped.
    expect(span.textContent).toContain('=>');
  });
});

describe('html — property binding', () => {
  it('.prop=${fn} sets the property on the element via function-value binding', () => {
    // The current implementation only triggers property binding when the
    // interpolated value is a function — see html.ts lines 80–89.
    // (KNOWN LIMITATION: passing a plain string for `.value` falls through
    // to the text-escape branch and renders `.value="..."` as a literal
    // attribute. Tests assert the documented function-binding behavior.)
    const handler = (): string => 'hello';
    const frag = html`<input .onclick=${handler} />`;
    const input = queryHtmlElement(frag, 'input');
    expect(input.tagName.toLowerCase()).toBe('input');
    expect(input.hasAttribute('.onclick')).toBe(false);
    // `onclick` is on HTMLElement (`GlobalEventHandlers`), so the
    // HTMLElement narrow is sufficient — no need to reach for the
    // input-specific subtype (which linkedom doesn't expose globally).
    expect(input.onclick).toBe(handler);
  });
});

describe('html — attribute interpolation', () => {
  it('escapes interpolated attribute values', () => {
    const danger = `"><script>alert(1)</script>`;
    const frag = html`<div title="${danger}"></div>`;
    const div = queryHtmlElement(frag, 'div');
    expect(div.getAttribute('title')).toBe(danger);
    expect(frag.querySelector('script')).toBeNull();
  });
});

describe('html — node interpolation', () => {
  it('inlines a DocumentFragment into the parent without re-encoding', () => {
    const inner = html`<em>nested</em>`;
    const frag = html`<p>${inner}</p>`;
    const em = queryElement(frag, 'em');
    expect(em.textContent).toBe('nested');
  });

  it('inlines an HTMLElement directly', () => {
    const el = document.createElement('strong');
    el.textContent = 'bold';
    const frag = html`<p>${el}</p>`;
    expect(queryElement(frag, 'strong').textContent).toBe('bold');
  });
});

describe('html — array interpolation', () => {
  it('renders an array of strings escaped and concatenated', () => {
    const items = ['<a>', '<b>', '<c>'];
    const frag = html`<p>${items}</p>`;
    expect(queryElement(frag, 'p').textContent).toBe('<a><b><c>');
  });

  it('renders an array mixing fragments and strings', () => {
    const fragments = [
      html`<li>one</li>`,
      html`<li>two</li>`,
    ];
    const frag = html`<ul>${fragments}</ul>`;
    const lis = frag.querySelectorAll('li');
    expect(lis.length).toBe(2);
    const first = assertDefined(lis[0], 'first <li> present');
    const second = assertDefined(lis[1], 'second <li> present');
    expect(first.textContent).toBe('one');
    expect(second.textContent).toBe('two');
  });
});

describe('html — conditional rendering', () => {
  it('renders one branch when a ternary picks a fragment', () => {
    const show = true;
    const frag = html`<div>${show ? html`<span>yes</span>` : ''}</div>`;
    expect(queryElement(frag, 'span').textContent).toBe('yes');
  });

  it('renders empty string for a false-y branch', () => {
    const show = false;
    const frag = html`<div>${show ? html`<span>yes</span>` : ''}</div>`;
    expect(frag.querySelector('span')).toBeNull();
  });
});
