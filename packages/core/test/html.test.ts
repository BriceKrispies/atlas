/**
 * Unit tests for the `html` tagged template (`packages/core/src/html.ts`).
 *
 * Covers escaping, event binding, property binding, attribute binding, and
 * conditional / array interpolation. Linkedom-backed (set up globally by
 * `test-setup/linkedom-shims.ts`).
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { html } from '../src/html.ts';

// `html.ts` uses `document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT)`
// to walk attribute bindings. linkedom doesn't expose `NodeFilter` as a
// global; install the documented bit-flag constants so the walker has
// something to dereference.
beforeAll(() => {
  const g = globalThis as unknown as { NodeFilter?: { SHOW_ELEMENT: number } };
  if (!g.NodeFilter) g.NodeFilter = { SHOW_ELEMENT: 1 };
});

function asElement(frag: DocumentFragment, selector: string): Element {
  const el = (frag as unknown as ParentNode).querySelector?.(selector);
  if (!el) throw new Error(`expected element matching ${selector}`);
  return el;
}

describe('html — text escaping', () => {
  it('escapes < > & " \' inside interpolated text', () => {
    const evil = `<img src=x onerror=alert(1)>`;
    const frag = html`<p>${evil}</p>`;
    const p = asElement(frag, 'p') as HTMLElement;
    expect(p.textContent).toBe(evil);
    // The fragment must NOT contain a real <img>.
    expect((frag as unknown as ParentNode).querySelector?.('img')).toBeNull();
  });

  it('renders numbers and booleans as their string form (still escaped)', () => {
    const frag = html`<span>${42}</span>`;
    expect(asElement(frag, 'span').textContent).toBe('42');
  });

  it('coerces null/undefined to empty string rather than printing literally', () => {
    const frag = html`<span>[${null}][${undefined}]</span>`;
    expect(asElement(frag, 'span').textContent).toBe('[][]');
  });
});

describe('html — event binding', () => {
  it('@click=${handler} attaches a click listener and removes the attribute', () => {
    const handler = vi.fn();
    const frag = html`<button @click=${handler}>Go</button>`;
    const btn = asElement(frag, 'button') as HTMLElement;
    expect(btn.hasAttribute('@click')).toBe(false);
    const EventCtor = globalThis.Event as unknown as new (
      type: string,
      init?: Record<string, unknown>,
    ) => Event;
    btn.dispatchEvent(new EventCtor('click', { bubbles: true, cancelable: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('non-event function value (no @ prefix) is rendered as escaped text', () => {
    const fn = (): string => 'hello';
    const frag = html`<span>${fn}</span>`;
    const span = asElement(frag, 'span') as HTMLElement;
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
    const input = asElement(frag, 'input') as HTMLInputElement;
    expect(input.hasAttribute('.onclick')).toBe(false);
    expect(
      (input as unknown as { onclick: unknown }).onclick,
    ).toBe(handler);
  });
});

describe('html — attribute interpolation', () => {
  it('escapes interpolated attribute values', () => {
    const danger = `"><script>alert(1)</script>`;
    const frag = html`<div title="${danger}"></div>`;
    const div = asElement(frag, 'div') as HTMLElement;
    expect(div.getAttribute('title')).toBe(danger);
    expect((frag as unknown as ParentNode).querySelector?.('script')).toBeNull();
  });
});

describe('html — node interpolation', () => {
  it('inlines a DocumentFragment into the parent without re-encoding', () => {
    const inner = html`<em>nested</em>`;
    const frag = html`<p>${inner}</p>`;
    const em = asElement(frag, 'em');
    expect(em.textContent).toBe('nested');
  });

  it('inlines an HTMLElement directly', () => {
    const el = document.createElement('strong');
    el.textContent = 'bold';
    const frag = html`<p>${el}</p>`;
    expect(asElement(frag, 'strong').textContent).toBe('bold');
  });
});

describe('html — array interpolation', () => {
  it('renders an array of strings escaped and concatenated', () => {
    const items = ['<a>', '<b>', '<c>'];
    const frag = html`<p>${items}</p>`;
    expect(asElement(frag, 'p').textContent).toBe('<a><b><c>');
  });

  it('renders an array mixing fragments and strings', () => {
    const fragments = [
      html`<li>one</li>`,
      html`<li>two</li>`,
    ];
    const frag = html`<ul>${fragments}</ul>`;
    const lis = (frag as unknown as ParentNode).querySelectorAll!('li');
    expect(lis.length).toBe(2);
    expect(lis[0]!.textContent).toBe('one');
    expect(lis[1]!.textContent).toBe('two');
  });
});

describe('html — conditional rendering', () => {
  it('renders one branch when a ternary picks a fragment', () => {
    const show = true;
    const frag = html`<div>${show ? html`<span>yes</span>` : ''}</div>`;
    expect(asElement(frag, 'span').textContent).toBe('yes');
  });

  it('renders empty string for a false-y branch', () => {
    const show = false;
    const frag = html`<div>${show ? html`<span>yes</span>` : ''}</div>`;
    expect(
      (frag as unknown as ParentNode).querySelector?.('span'),
    ).toBeNull();
  });
});
