/**
 * Unit tests for AtlasElement / AtlasSurface (`packages/core/src/component.ts`).
 *
 * Linkedom-backed (test-setup/linkedom-shims.ts installs the DOM shims).
 *
 * Coverage:
 *   - AtlasElement.define idempotency
 *   - boolAttr / strAttr round-trips
 *   - surfaceId walks parent chain (and shadow-host hop is exercised)
 *   - AtlasSurface state machine emits Surface.State.<from>.<to> transitions
 *   - _safeRender swallows render throws and emits Atlas.Render.Failed
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { AtlasElement, AtlasSurface, html } from '../src/index.ts';
import {
  setTelemetrySink,
  type TelemetryEvent,
  type TelemetrySink,
} from '../src/telemetry-pipeline.ts';

// ── helpers ─────────────────────────────────────────────────────────

function makeRecorder(): { events: TelemetryEvent[]; sink: TelemetrySink } {
  const events: TelemetryEvent[] = [];
  const sink: TelemetrySink = {
    write(ev) {
      events.push(ev);
    },
  };
  return { events, sink };
}

let _tagCounter = 0;
function uniqueTag(prefix: string): string {
  _tagCounter += 1;
  return `${prefix}-${_tagCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

beforeAll(() => {
  // linkedom doesn't expose NodeFilter globally; @atlas/core's html
  // template tag uses NodeFilter.SHOW_ELEMENT (=1) for createTreeWalker.
  const g = globalThis as unknown as { NodeFilter?: { SHOW_ELEMENT: number } };
  if (!g.NodeFilter) g.NodeFilter = { SHOW_ELEMENT: 1 };
});

beforeEach(() => {
  setTelemetrySink(null);
  // Wipe document body so each test starts fresh
  if (typeof document !== 'undefined') {
    document.body.innerHTML = '';
  }
});

// ── AtlasElement.define idempotency ─────────────────────────────────

describe('AtlasElement.define', () => {
  it('is a no-op when re-defining the same tag with the same constructor', () => {
    const tag = uniqueTag('atlas-test-define');
    class A extends AtlasElement {}
    AtlasElement.define(tag, A);
    expect(() => AtlasElement.define(tag, A)).not.toThrow();
    expect(customElements.get(tag)).toBe(A);
  });

  it('warns once and ignores re-registration with a different constructor', () => {
    const tag = uniqueTag('atlas-test-define');
    class A extends AtlasElement {}
    class B extends AtlasElement {}
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    AtlasElement.define(tag, A);
    AtlasElement.define(tag, B); // different ctor → warn + skip
    AtlasElement.define(tag, B); // already-warned: silent
    expect(customElements.get(tag)).toBe(A); // first registration wins
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

// ── attribute reflection ────────────────────────────────────────────

describe('AtlasElement.boolAttr / strAttr reflection', () => {
  it('boolAttr round-trips presence', () => {
    class WithFlag extends AtlasElement {
      declare disabled: boolean;
      static {
        Object.defineProperty(
          this.prototype,
          'disabled',
          AtlasElement.boolAttr('disabled'),
        );
      }
    }
    const tag = uniqueTag('atlas-bool');
    AtlasElement.define(tag, WithFlag);
    const el = document.createElement(tag) as WithFlag;
    expect(el.disabled).toBe(false);
    el.disabled = true;
    expect(el.hasAttribute('disabled')).toBe(true);
    expect(el.disabled).toBe(true);
    el.disabled = false;
    expect(el.hasAttribute('disabled')).toBe(false);
    expect(el.disabled).toBe(false);
  });

  it('strAttr returns the default when unset and persists writes', () => {
    class WithType extends AtlasElement {
      declare kind: string;
      static {
        Object.defineProperty(
          this.prototype,
          'kind',
          AtlasElement.strAttr('kind', 'primary'),
        );
      }
    }
    const tag = uniqueTag('atlas-str');
    AtlasElement.define(tag, WithType);
    const el = document.createElement(tag) as WithType;
    expect(el.kind).toBe('primary');
    el.kind = 'danger';
    expect(el.getAttribute('kind')).toBe('danger');
    expect(el.kind).toBe('danger');
  });

  it('strAttr setter with null/undefined removes the attribute', () => {
    class WithName extends AtlasElement {
      declare label: string;
      static {
        Object.defineProperty(
          this.prototype,
          'label',
          AtlasElement.strAttr('label', ''),
        );
      }
    }
    const tag = uniqueTag('atlas-str-null');
    AtlasElement.define(tag, WithName);
    const el = document.createElement(tag) as WithName;
    el.label = 'hello';
    expect(el.getAttribute('label')).toBe('hello');
    (el as { label: unknown }).label = null;
    expect(el.hasAttribute('label')).toBe(false);
  });
});

// ── surfaceId walk ──────────────────────────────────────────────────

describe('AtlasElement.surface / surfaceId', () => {
  it('returns "" when there is no AtlasSurface ancestor', () => {
    class Plain extends AtlasElement {}
    const tag = uniqueTag('atlas-plain');
    AtlasElement.define(tag, Plain);
    const el = document.createElement(tag) as Plain;
    document.body.appendChild(el);
    expect(el.surface).toBeNull();
    expect(el.surfaceId).toBe('');
  });

  it('finds the nearest AtlasSurface ancestor and reports its id', () => {
    class Surf extends AtlasSurface {
      static override surfaceId = 'surf-123';
    }
    class Child extends AtlasElement {}
    const surfTag = uniqueTag('atlas-surf');
    const childTag = uniqueTag('atlas-child');
    AtlasElement.define(surfTag, Surf);
    AtlasElement.define(childTag, Child);

    const surface = document.createElement(surfTag) as Surf;
    const child = document.createElement(childTag) as Child;
    surface.appendChild(child);
    document.body.appendChild(surface);

    expect(child.surface).toBe(surface);
    expect(child.surfaceId).toBe('surf-123');
  });

  it('crosses a shadow-root boundary via the host when looking for the surface', () => {
    // linkedom's attachShadow returns a real ShadowRoot whose host points
    // back at the element we attached to — exactly what the surface walker
    // needs. The shim file installed `globalThis.ShadowRoot` so the
    // `instanceof ShadowRoot` check inside `.surface` is meaningful.
    class Surf extends AtlasSurface {
      static override surfaceId = 'shadow-surf';
    }
    const surfTag = uniqueTag('atlas-shadow-surf');
    AtlasElement.define(surfTag, Surf);
    const surface = document.createElement(surfTag) as Surf;
    document.body.appendChild(surface);

    // Host the child inside a shadow root attached to a host element that
    // sits inside the surface — surface walker must hop host→shadow→host
    // back into the light DOM.
    const host = document.createElement('div');
    surface.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });

    class Inner extends AtlasElement {}
    const innerTag = uniqueTag('atlas-shadow-inner');
    AtlasElement.define(innerTag, Inner);
    const inner = document.createElement(innerTag) as Inner;
    root.appendChild(inner);

    expect(inner.surfaceId).toBe('shadow-surf');
  });
});

// ── data-testid wiring ──────────────────────────────────────────────

describe('AtlasElement._applyTestId', () => {
  it('sets data-testid="${surfaceId}.${name}" on connect when both present', () => {
    class Surf extends AtlasSurface {
      static override surfaceId = 'page';
    }
    class Btn extends AtlasElement {}
    const stag = uniqueTag('atlas-page');
    const btag = uniqueTag('atlas-btn');
    AtlasElement.define(stag, Surf);
    AtlasElement.define(btag, Btn);

    const surf = document.createElement(stag);
    const btn = document.createElement(btag);
    btn.setAttribute('name', 'save');
    surf.appendChild(btn);
    document.body.appendChild(surf);

    // connectedCallback runs synchronously on append in linkedom
    expect(btn.getAttribute('data-testid')).toBe('page.save');
  });

  it('appends key when both name and key are present', () => {
    class Surf extends AtlasSurface {
      static override surfaceId = 'list';
    }
    class Row extends AtlasElement {}
    const stag = uniqueTag('atlas-list-surf');
    const rtag = uniqueTag('atlas-row');
    AtlasElement.define(stag, Surf);
    AtlasElement.define(rtag, Row);

    const surf = document.createElement(stag);
    const row = document.createElement(rtag);
    row.setAttribute('name', 'row');
    row.setAttribute('key', 'pg_001');
    surf.appendChild(row);
    document.body.appendChild(surf);

    expect(row.getAttribute('data-testid')).toBe('list.row.pg_001');
  });
});

// ── AtlasSurface state machine ──────────────────────────────────────

describe('AtlasSurface state transitions', () => {
  it('setState emits Surface.State.<from>.<to> on first transition and on every change', () => {
    const { events, sink } = makeRecorder();
    setTelemetrySink(sink);

    class Surf extends AtlasSurface {
      static override surfaceId = 'state-surf';
    }
    const tag = uniqueTag('atlas-state-surf');
    AtlasElement.define(tag, Surf);
    const surf = document.createElement(tag) as Surf;
    document.body.appendChild(surf);

    surf.setState('loading');
    surf.setState('success');
    surf.setState('empty');
    surf.setState('error');
    surf.setState('unauthorized');
    // Identical state is a no-op (no duplicate emit)
    surf.setState('unauthorized');

    const transitions = events
      .filter((e) => e.eventName.startsWith('Surface.State.'))
      .map((e) => e.eventName);
    expect(transitions).toEqual([
      'Surface.State.init.loading',
      'Surface.State.loading.success',
      'Surface.State.success.empty',
      'Surface.State.empty.error',
      'Surface.State.error.unauthorized',
    ]);
  });

  it('reflects the active state via data-state attribute', () => {
    class Surf extends AtlasSurface {
      static override surfaceId = 'attr-surf';
    }
    const tag = uniqueTag('atlas-attr-surf');
    AtlasElement.define(tag, Surf);
    const surf = document.createElement(tag) as Surf;
    document.body.appendChild(surf);

    surf.setState('loading');
    expect(surf.getAttribute('data-state')).toBe('loading');
    surf.setState('success');
    expect(surf.getAttribute('data-state')).toBe('success');
  });

  it('successful managed load transitions through loading → success', async () => {
    const { events, sink } = makeRecorder();
    setTelemetrySink(sink);

    class Surf extends AtlasSurface {
      static override surfaceId = 'managed-surf';
      override async load(): Promise<unknown> {
        return [{ id: 1 }];
      }
    }
    const tag = uniqueTag('atlas-managed');
    AtlasElement.define(tag, Surf);
    const surf = document.createElement(tag) as Surf;
    document.body.appendChild(surf);

    // Allow the managed load microtask to complete.
    await new Promise((r) => setTimeout(r, 0));
    await Promise.resolve();

    const names = events
      .filter((e) => e.eventName.startsWith('Surface.State.'))
      .map((e) => e.eventName);
    expect(names).toEqual([
      'Surface.State.init.loading',
      'Surface.State.loading.success',
    ]);
  });

  it('failed load transitions to error and surfaces the message', async () => {
    class Surf extends AtlasSurface {
      static override surfaceId = 'fail-surf';
      override async load(): Promise<unknown> {
        throw new Error('boom');
      }
    }
    const tag = uniqueTag('atlas-fail');
    AtlasElement.define(tag, Surf);
    const surf = document.createElement(tag) as Surf;
    document.body.appendChild(surf);

    await new Promise((r) => setTimeout(r, 0));
    await Promise.resolve();
    expect(surf.getAttribute('data-state')).toBe('error');
  });
});

// ── _safeRender ─────────────────────────────────────────────────────

describe('AtlasElement._safeRender', () => {
  it('emits Atlas.Render.Failed when render() throws (rethrows in dev)', () => {
    // Vitest sets import.meta.env.DEV=true by default, so `_safeRender`
    // emits Atlas.Render.Failed AND rethrows. We catch the rethrow and
    // assert on the emitted telemetry event — that's the contract that
    // matters for tests / observability.
    const { events, sink } = makeRecorder();
    setTelemetrySink(sink);

    class Boom extends AtlasElement {
      override render(): DocumentFragment {
        throw new Error('render-explode');
      }
    }
    const tag = uniqueTag('atlas-boom');
    AtlasElement.define(tag, Boom);
    const el = document.createElement(tag) as Boom;
    try {
      document.body.appendChild(el);
    } catch {
      // Expected in dev: _safeRender rethrows so vitest fails loudly.
    }

    const failures = events.filter((e) => e.eventName === 'Atlas.Render.Failed');
    expect(failures.length).toBeGreaterThanOrEqual(1);
    const failure = failures[0]!;
    expect((failure['error'] as { message: string }).message).toBe(
      'render-explode',
    );
    expect(failure['tagName']).toBe(tag);
  });

  it('a successful render() mounts the returned fragment as element content', () => {
    class Greet extends AtlasElement {
      override render(): DocumentFragment {
        return html`<span class="x">hi</span>`;
      }
    }
    const tag = uniqueTag('atlas-greet');
    AtlasElement.define(tag, Greet);
    const el = document.createElement(tag) as Greet;
    document.body.appendChild(el);
    expect(el.querySelector('span.x')?.textContent).toBe('hi');
  });
});

// ── emit() — surface context ────────────────────────────────────────

describe('AtlasElement.emit', () => {
  it('routes through the active telemetry sink with surfaceId stamped', () => {
    const { events, sink } = makeRecorder();
    setTelemetrySink(sink);

    class Surf extends AtlasSurface {
      static override surfaceId = 'emit-surf';
    }
    class Btn extends AtlasElement {}
    const stag = uniqueTag('atlas-emit-surf');
    const btag = uniqueTag('atlas-emit-btn');
    AtlasElement.define(stag, Surf);
    AtlasElement.define(btag, Btn);

    const surf = document.createElement(stag);
    const btn = document.createElement(btag) as Btn;
    surf.appendChild(btn);
    document.body.appendChild(surf);

    btn.emit('Custom.Click', { foo: 'bar' });
    const ev = events.find((e) => e.eventName === 'Custom.Click');
    expect(ev).toBeDefined();
    expect(ev!.surfaceId).toBe('emit-surf');
    expect(ev!['foo']).toBe('bar');
    expect(typeof ev!.timestamp).toBe('string');
  });
});
