/**
 * Unit tests for AtlasElement / AtlasSurface (`packages/core/src/component.ts`).
 *
 * Linkedom-backed (test-setup/linkedom-shims.ts installs the DOM shims,
 * including NodeFilter, ShadowRoot, etc).
 *
 * Coverage:
 *   - AtlasElement.define idempotency
 *   - boolAttr / strAttr round-trips
 *   - surfaceId walks parent chain (and shadow-host hop is exercised)
 *   - AtlasSurface state machine emits Surface.State.<from>.<to> transitions
 *   - _safeRender swallows render throws and emits Atlas.Render.Failed
 */
import { describe, it, expect, beforeEach, vi } from '@atlas/test';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { AtlasElement, AtlasSurface, html } from '../src/index.ts';
import { setTelemetrySink, type TelemetryEvent, type TelemetrySink, } from '../src/telemetry-pipeline.ts';
// ── helpers ─────────────────────────────────────────────────────────
function makeRecorder(): {
    events: TelemetryEvent[];
    sink: TelemetrySink;
} {
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
/**
 * Register a custom-element class under a fresh tag, create an instance,
 * and narrow it with `instanceof` so the test can call subclass methods
 * without a cast. Replaces the ad-hoc `document.createElement(tag) as Foo`
 * pattern that triggers `no-unsafe-type-assertion` since `tag` isn't in
 * `HTMLElementTagNameMap`.
 */
function defineAndCreate<T extends AtlasElement>(tag: string, ctor: new () => T): T {
    AtlasElement.define(tag, ctor);
    const el = document.createElement(tag);
    if (!(el instanceof ctor)) {
        throw new Error(`Test invariant violation: createElement('${tag}') did not yield an instance of ${ctor.name}`);
    }
    return el;
}
/** Narrow a captured telemetry event's `error` field. */
function errorMessage(ev: TelemetryEvent): string {
    const err: unknown = ev['error'];
    if (typeof err !== 'object' ||
        err === null ||
        !('message' in err) ||
        typeof err.message !== 'string') {
        throw new Error(`Test invariant violation: expected error.message string on event, got ${JSON.stringify(err)}`);
    }
    return err.message;
}
beforeEach(function () {
    setTelemetrySink(null);
    // Wipe document body so each test starts fresh
    if (typeof document !== 'undefined') {
        document.body.innerHTML = '';
    }
});
// ── AtlasElement.define idempotency ─────────────────────────────────
describe('AtlasElement.define', function () {
    it('is a no-op when re-defining the same tag with the same constructor', function () {
        const tag = uniqueTag('atlas-test-define');
        class A extends AtlasElement {
        }
        AtlasElement.define(tag, A);
        expect(function () {
            return AtlasElement.define(tag, A);
        }).not.toThrow();
        expect(customElements.get(tag)).toBe(A);
    });
    it('warns once and ignores re-registration with a different constructor', function () {
        const tag = uniqueTag('atlas-test-define');
        class A extends AtlasElement {
        }
        class B extends AtlasElement {
        }
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(function () { });
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
                Object.defineProperty(this.prototype, 'disabled', AtlasElement.boolAttr('disabled'));
            }
        }
        const el = defineAndCreate(uniqueTag('atlas-bool'), WithFlag);
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
                Object.defineProperty(this.prototype, 'kind', AtlasElement.strAttr('kind', 'primary'));
            }
        }
        const el = defineAndCreate(uniqueTag('atlas-str'), WithType);
        expect(el.kind).toBe('primary');
        el.kind = 'danger';
        expect(el.getAttribute('kind')).toBe('danger');
        expect(el.kind).toBe('danger');
    });
    it('strAttr setter with null/undefined removes the attribute', () => {
        class WithName extends AtlasElement {
            declare label: string;
            static {
                Object.defineProperty(this.prototype, 'label', AtlasElement.strAttr('label', ''));
            }
        }
        const el = defineAndCreate(uniqueTag('atlas-str-null'), WithName);
        el.label = 'hello';
        expect(el.getAttribute('label')).toBe('hello');
        (el as {
            label: unknown;
        }).label = null;
        expect(el.hasAttribute('label')).toBe(false);
    });
});
// ── surfaceId walk ──────────────────────────────────────────────────
describe('AtlasElement.surface / surfaceId', function () {
    it('returns "" when there is no AtlasSurface ancestor', function () {
        class Plain extends AtlasElement {
        }
        const el = defineAndCreate(uniqueTag('atlas-plain'), Plain);
        document.body.appendChild(el);
        expect(el.surface).toBeNull();
        expect(el.surfaceId).toBe('');
    });
    it('finds the nearest AtlasSurface ancestor and reports its id', function () {
        class Surf extends AtlasSurface {
            static override surfaceId = 'surf-123';
        }
        class Child extends AtlasElement {
        }
        const surface = defineAndCreate(uniqueTag('atlas-surf'), Surf);
        const child = defineAndCreate(uniqueTag('atlas-child'), Child);
        surface.appendChild(child);
        document.body.appendChild(surface);
        expect(child.surface).toBe(surface);
        expect(child.surfaceId).toBe('surf-123');
    });
    it('crosses a shadow-root boundary via the host when looking for the surface', function () {
        // linkedom's attachShadow returns a real ShadowRoot whose host points
        // back at the element we attached to — exactly what the surface walker
        // needs. The shim file installed `globalThis.ShadowRoot` so the
        // `instanceof ShadowRoot` check inside `.surface` is meaningful.
        class Surf extends AtlasSurface {
            static override surfaceId = 'shadow-surf';
        }
        const surface = defineAndCreate(uniqueTag('atlas-shadow-surf'), Surf);
        document.body.appendChild(surface);
        // Host the child inside a shadow root attached to a host element that
        // sits inside the surface — surface walker must hop host→shadow→host
        // back into the light DOM.
        const host = document.createElement('div');
        surface.appendChild(host);
        const root = host.attachShadow({ mode: 'open' });
        class Inner extends AtlasElement {
        }
        const inner = defineAndCreate(uniqueTag('atlas-shadow-inner'), Inner);
        root.appendChild(inner);
        expect(inner.surfaceId).toBe('shadow-surf');
    });
});
// ── data-testid wiring ──────────────────────────────────────────────
describe('AtlasElement._applyTestId', function () {
    it('sets data-testid="${surfaceId}.${name}" on connect when both present', function () {
        class Surf extends AtlasSurface {
            static override surfaceId = 'page';
        }
        class Btn extends AtlasElement {
        }
        const surf = defineAndCreate(uniqueTag('atlas-page'), Surf);
        const btn = defineAndCreate(uniqueTag('atlas-btn'), Btn);
        btn.setAttribute('name', 'save');
        surf.appendChild(btn);
        document.body.appendChild(surf);
        // connectedCallback runs synchronously on append in linkedom
        expect(btn.getAttribute('data-testid')).toBe('page.save');
    });
    it('appends key when both name and key are present', function () {
        class Surf extends AtlasSurface {
            static override surfaceId = 'list';
        }
        class Row extends AtlasElement {
        }
        const surf = defineAndCreate(uniqueTag('atlas-list-surf'), Surf);
        const row = defineAndCreate(uniqueTag('atlas-row'), Row);
        row.setAttribute('name', 'row');
        row.setAttribute('key', 'pg_001');
        surf.appendChild(row);
        document.body.appendChild(surf);
        expect(row.getAttribute('data-testid')).toBe('list.row.pg_001');
    });
});
// ── AtlasSurface state machine ──────────────────────────────────────
describe('AtlasSurface state transitions', function () {
    it('setState emits Surface.State.<from>.<to> on first transition and on every change', function () {
        const { events, sink } = makeRecorder();
        setTelemetrySink(sink);
        class Surf extends AtlasSurface {
            static override surfaceId = 'state-surf';
        }
        const surf = defineAndCreate(uniqueTag('atlas-state-surf'), Surf);
        document.body.appendChild(surf);
        surf.setState('loading');
        surf.setState('success');
        surf.setState('empty');
        surf.setState('error');
        surf.setState('unauthorized');
        // Identical state is a no-op (no duplicate emit)
        surf.setState('unauthorized');
        const transitions = events
            .filter(function (e) {
            return e.eventName.startsWith('Surface.State.');
        })
            .map(function (e) {
            return e.eventName;
        });
        expect(transitions).toEqual([
            'Surface.State.init.loading',
            'Surface.State.loading.success',
            'Surface.State.success.empty',
            'Surface.State.empty.error',
            'Surface.State.error.unauthorized',
        ]);
    });
    it('reflects the active state via data-state attribute', function () {
        class Surf extends AtlasSurface {
            static override surfaceId = 'attr-surf';
        }
        const surf = defineAndCreate(uniqueTag('atlas-attr-surf'), Surf);
        document.body.appendChild(surf);
        surf.setState('loading');
        expect(surf.getAttribute('data-state')).toBe('loading');
        surf.setState('success');
        expect(surf.getAttribute('data-state')).toBe('success');
    });
    it('successful managed load transitions through loading → success', async function () {
        const { events, sink } = makeRecorder();
        setTelemetrySink(sink);
        class Surf extends AtlasSurface {
            static override surfaceId = 'managed-surf';
            override async load(): Promise<unknown> {
                return [{ id: 1 }];
            }
        }
        const surf = defineAndCreate(uniqueTag('atlas-managed'), Surf);
        document.body.appendChild(surf);
        // Allow the managed load microtask to complete.
        await new Promise(function (r) {
            return setTimeout(r, 0);
        });
        await Promise.resolve();
        const names = events
            .filter(function (e) {
            return e.eventName.startsWith('Surface.State.');
        })
            .map(function (e) {
            return e.eventName;
        });
        expect(names).toEqual([
            'Surface.State.init.loading',
            'Surface.State.loading.success',
        ]);
    });
    it('failed load transitions to error and surfaces the message', async function () {
        class Surf extends AtlasSurface {
            static override surfaceId = 'fail-surf';
            override async load(): Promise<unknown> {
                throw new Error('boom');
            }
        }
        const surf = defineAndCreate(uniqueTag('atlas-fail'), Surf);
        document.body.appendChild(surf);
        await new Promise(function (r) {
            return setTimeout(r, 0);
        });
        await Promise.resolve();
        expect(surf.getAttribute('data-state')).toBe('error');
    });
});
// ── _safeRender ─────────────────────────────────────────────────────
describe('AtlasElement._safeRender', function () {
    it('emits Atlas.Render.Failed when render() throws (rethrows in dev)', function () {
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
        const el = defineAndCreate(tag, Boom);
        try {
            document.body.appendChild(el);
        }
        catch {
            // Expected in dev: _safeRender rethrows so vitest fails loudly.
        }
        const failures = events.filter(function (e) {
            return e.eventName === 'Atlas.Render.Failed';
        });
        expect(failures.length).toBeGreaterThanOrEqual(1);
        const failure = assertDefined(failures[0], 'at least one Atlas.Render.Failed event');
        expect(errorMessage(failure)).toBe('render-explode');
        expect(failure['tagName']).toBe(tag);
    });
    it('a successful render() mounts the returned fragment as element content', function () {
        class Greet extends AtlasElement {
            override render(): DocumentFragment {
                return html `<span class="x">hi</span>`;
            }
        }
        const el = defineAndCreate(uniqueTag('atlas-greet'), Greet);
        document.body.appendChild(el);
        expect(el.querySelector('span.x')?.textContent).toBe('hi');
    });
});
// ── emit() — surface context ────────────────────────────────────────
describe('AtlasElement.emit', function () {
    it('routes through the active telemetry sink with surfaceId stamped', function () {
        const { events, sink } = makeRecorder();
        setTelemetrySink(sink);
        class Surf extends AtlasSurface {
            static override surfaceId = 'emit-surf';
        }
        class Btn extends AtlasElement {
        }
        const surf = defineAndCreate(uniqueTag('atlas-emit-surf'), Surf);
        const btn = defineAndCreate(uniqueTag('atlas-emit-btn'), Btn);
        surf.appendChild(btn);
        document.body.appendChild(surf);
        btn.emit('Custom.Click', { foo: 'bar' });
        const ev = assertDefined(events.find(function (e) {
            return e.eventName === 'Custom.Click';
        }), 'emit recorded a Custom.Click event');
        expect(ev.surfaceId).toBe('emit-surf');
        expect(ev['foo']).toBe('bar');
        expect(typeof ev.timestamp).toBe('string');
    });
});
