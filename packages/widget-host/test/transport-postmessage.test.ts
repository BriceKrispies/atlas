/**
 * postMessage transport tests.
 *
 * The transport is the trust boundary between the host and a sandboxed
 * iframe widget. It must:
 *
 *   - reject messages whose `event.source` is NOT the iframe.contentWindow
 *     (origin is "null" for sandboxed iframes — source identity is the
 *     only valid filter)
 *   - silently ignore malformed envelopes (forward compatibility)
 *   - dispatch each known kind (widget-ready, publish, capability.invoke, log)
 *     to the right callback
 *   - route the new `kind: 'log'` LogEnvelope to onLog when set, drop when unset
 *   - dispose() removes the message listener
 */
import { describe, it, expect, vi, beforeEach, afterEach } from '@atlas/test';
import { createPostMessageTransport } from '../src/transport/postmessage.ts';
// ── lightweight fakes for the host window + iframe ─────────────────
//
// We don't rely on linkedom for window.addEventListener('message') —
// instead we install a tiny EventTarget shim on globalThis.window for
// the duration of the test and dispatch synthetic MessageEvents.
interface FakeMessageEvent {
    data: unknown;
    source: unknown;
}
class FakeWindow {
    private listeners: Array<(e: FakeMessageEvent) => void> = [];
    addEventListener(type: string, cb: (e: FakeMessageEvent) => void): void {
        if (type !== 'message')
            return;
        this.listeners.push(cb);
    }
    removeEventListener(type: string, cb: (e: FakeMessageEvent) => void): void {
        if (type !== 'message')
            return;
        this.listeners = this.listeners.filter(function (l) {
            return l !== cb;
        });
    }
    fire(ev: FakeMessageEvent): void {
        for (const l of [...this.listeners])
            l(ev);
    }
    get listenerCount(): number {
        return this.listeners.length;
    }
}
/** The transport only ever touches `iframe.contentWindow` — see
 *  `packages/widget-host/src/transport/postmessage.ts`. We model only
 *  that slice so each call-site can pass a structurally-typed fake
 *  without an `as unknown as HTMLIFrameElement` escape hatch. */
interface FakeContentWindow {
    postedMessages: unknown[];
    postMessage: (m: unknown) => void;
}
interface FakeIframe {
    contentWindow: FakeContentWindow;
}
function makeIframe(): FakeIframe {
    const messages: unknown[] = [];
    const win: FakeContentWindow = {
        postedMessages: messages,
        postMessage: function (m: unknown): void {
            messages.push(m);
        },
    };
    return { contentWindow: win };
}
/** Single boundary cast: the transport's signature requires the full
 *  DOM `HTMLIFrameElement`, but it only reads `.contentWindow`. linkedom
 *  + this test's FakeWindow give us a structurally-compatible shape; we
 *  funnel every call through this helper so the cast lives in one place. */
function asIframe(fake: FakeIframe): HTMLIFrameElement {
    // eslint-disable-next-line atlas-widgets/no-double-cast, @typescript-eslint/no-unsafe-type-assertion -- boundary: linkedom-DOM-shape; transport only reads iframe.contentWindow, the FakeIframe matches that slice structurally.
    return fake as unknown as HTMLIFrameElement;
}
/** Narrow vi.fn() mock call arg (`unknown[][]`) to a known wire-protocol
 *  shape without escape-hatch casts. Throws with a useful message if the
 *  call wasn't made — replaces `mock.calls[0]![0] as T` patterns. */
function firstCallArg<T>(mock: {
    mock: {
        calls: ReadonlyArray<ReadonlyArray<unknown>>;
    };
}, guard: (v: unknown) => v is T, label: string): T {
    const calls = mock.mock.calls;
    if (calls.length === 0) {
        throw new Error(`Test invariant: ${label} mock was not called`);
    }
    const first = calls[0];
    if (!first || first.length === 0) {
        throw new Error(`Test invariant: ${label} mock call had no args`);
    }
    const arg = first[0];
    if (!guard(arg)) {
        throw new Error(`Test invariant: ${label} mock arg did not match expected shape (got ${typeof arg})`);
    }
    return arg;
}
interface LogCallArg {
    level: string;
    args: ReadonlyArray<unknown>;
}
function isLogCallArg(v: unknown): v is LogCallArg {
    return (typeof v === 'object' &&
        v !== null &&
        'level' in v &&
        'args' in v &&
        typeof (v as {
            level: unknown;
        }).level === 'string' &&
        Array.isArray((v as {
            args: unknown;
        }).args));
}
let prevWindow: unknown;
let fakeWin: FakeWindow;
beforeEach(function () {
    fakeWin = new FakeWindow();
    prevWindow = (globalThis as {
        window?: unknown;
    }).window;
    (globalThis as {
        window?: unknown;
    }).window = fakeWin;
});
afterEach(function () {
    if (prevWindow !== undefined) {
        (globalThis as {
            window?: unknown;
        }).window = prevWindow;
    }
    else {
        delete (globalThis as {
            window?: unknown;
        }).window;
    }
});
describe('createPostMessageTransport — source filter', function () {
    it('ignores messages whose event.source is not the iframe.contentWindow', function () {
        const onReady = vi.fn();
        const iframe = makeIframe();
        createPostMessageTransport({
            iframe: asIframe(iframe),
            onReady,
            onPublish: vi.fn(),
            onCapabilityInvoke: vi.fn(),
        });
        // event.source is a different window — must NOT trigger onReady.
        fakeWin.fire({
            data: { kind: 'widget-ready' },
            source: { not: 'our-iframe' },
        });
        expect(onReady).not.toHaveBeenCalled();
    });
    it('accepts messages whose event.source matches iframe.contentWindow', function () {
        const onReady = vi.fn();
        const iframe = makeIframe();
        createPostMessageTransport({
            iframe: asIframe(iframe),
            onReady,
            onPublish: vi.fn(),
            onCapabilityInvoke: vi.fn(),
        });
        fakeWin.fire({
            data: { kind: 'widget-ready' },
            source: iframe.contentWindow,
        });
        expect(onReady).toHaveBeenCalledTimes(1);
    });
});
describe('createPostMessageTransport — malformed envelopes', function () {
    it('drops non-object data', function () {
        const onReady = vi.fn();
        const iframe = makeIframe();
        createPostMessageTransport({
            iframe: asIframe(iframe),
            onReady,
            onPublish: vi.fn(),
            onCapabilityInvoke: vi.fn(),
        });
        fakeWin.fire({ data: 'not-an-object', source: iframe.contentWindow });
        fakeWin.fire({ data: null, source: iframe.contentWindow });
        fakeWin.fire({ data: 42, source: iframe.contentWindow });
        expect(onReady).not.toHaveBeenCalled();
    });
    it('drops messages with unknown kinds', function () {
        const onReady = vi.fn();
        const onPublish = vi.fn();
        const onCapabilityInvoke = vi.fn();
        const onLog = vi.fn();
        const iframe = makeIframe();
        createPostMessageTransport({
            iframe: asIframe(iframe),
            onReady,
            onPublish,
            onCapabilityInvoke,
            onLog,
        });
        fakeWin.fire({
            data: { kind: 'something-strange' },
            source: iframe.contentWindow,
        });
        expect(onReady).not.toHaveBeenCalled();
        expect(onPublish).not.toHaveBeenCalled();
        expect(onCapabilityInvoke).not.toHaveBeenCalled();
        expect(onLog).not.toHaveBeenCalled();
    });
    it('drops messages with no kind field', function () {
        const onReady = vi.fn();
        const iframe = makeIframe();
        createPostMessageTransport({
            iframe: asIframe(iframe),
            onReady,
            onPublish: vi.fn(),
            onCapabilityInvoke: vi.fn(),
        });
        fakeWin.fire({ data: { foo: 'bar' }, source: iframe.contentWindow });
        expect(onReady).not.toHaveBeenCalled();
    });
});
describe('createPostMessageTransport — message dispatch', function () {
    it('routes "publish" envelopes to onPublish with topic + payload', function () {
        const onPublish = vi.fn();
        const iframe = makeIframe();
        createPostMessageTransport({
            iframe: asIframe(iframe),
            onReady: vi.fn(),
            onPublish,
            onCapabilityInvoke: vi.fn(),
        });
        fakeWin.fire({
            data: { kind: 'publish', topic: 'a.fired', payload: { v: 1 } },
            source: iframe.contentWindow,
        });
        expect(onPublish).toHaveBeenCalledWith({ topic: 'a.fired', payload: { v: 1 } });
    });
    it('routes "capability.invoke" envelopes to onCapabilityInvoke with id+capability+payload', function () {
        const onCapabilityInvoke = vi.fn();
        const iframe = makeIframe();
        createPostMessageTransport({
            iframe: asIframe(iframe),
            onReady: vi.fn(),
            onPublish: vi.fn(),
            onCapabilityInvoke,
        });
        fakeWin.fire({
            data: {
                kind: 'capability.invoke',
                id: 'req-7',
                capability: 'backend.query',
                payload: { q: 1 },
            },
            source: iframe.contentWindow,
        });
        expect(onCapabilityInvoke).toHaveBeenCalledWith({
            id: 'req-7',
            capability: 'backend.query',
            payload: { q: 1 },
        });
    });
});
describe('createPostMessageTransport — log envelope (LogEnvelope)', function () {
    it('routes kind: "log" to onLog when present, normalising level + args', function () {
        const onLog = vi.fn();
        const iframe = makeIframe();
        createPostMessageTransport({
            iframe: asIframe(iframe),
            onReady: vi.fn(),
            onPublish: vi.fn(),
            onCapabilityInvoke: vi.fn(),
            onLog,
        });
        fakeWin.fire({
            data: {
                kind: 'log',
                level: 'warn',
                args: ['oops', { code: 1 }],
            },
            source: iframe.contentWindow,
        });
        expect(onLog).toHaveBeenCalledTimes(1);
        const arg = firstCallArg(onLog, isLogCallArg, 'onLog');
        expect(arg.level).toBe('warn');
        // Args are coerced to string per the contract.
        expect(arg.args[0]).toBe('oops');
        expect(typeof arg.args[1]).toBe('string');
    });
    it('coerces unknown level values to "info"', function () {
        const onLog = vi.fn();
        const iframe = makeIframe();
        createPostMessageTransport({
            iframe: asIframe(iframe),
            onReady: vi.fn(),
            onPublish: vi.fn(),
            onCapabilityInvoke: vi.fn(),
            onLog,
        });
        fakeWin.fire({
            data: { kind: 'log', level: 'fatal', args: ['x'] },
            source: iframe.contentWindow,
        });
        const arg = firstCallArg(onLog, isLogCallArg, 'onLog');
        expect(arg.level).toBe('info');
    });
    it('drops "log" envelopes silently when onLog is not provided', function () {
        const iframe = makeIframe();
        createPostMessageTransport({
            iframe: asIframe(iframe),
            onReady: vi.fn(),
            onPublish: vi.fn(),
            onCapabilityInvoke: vi.fn(),
            // no onLog
        });
        expect(function () {
            return fakeWin.fire({
                data: { kind: 'log', level: 'info', args: ['x'] },
                source: iframe.contentWindow,
            });
        }).not.toThrow();
    });
});
describe('createPostMessageTransport — send + dispose', function () {
    it('send() forwards an envelope to iframe.contentWindow.postMessage', function () {
        const iframe = makeIframe();
        const t = createPostMessageTransport({
            iframe: asIframe(iframe),
            onReady: vi.fn(),
            onPublish: vi.fn(),
            onCapabilityInvoke: vi.fn(),
        });
        t.send({
            kind: 'capability.ack',
            id: 'r-1',
            ok: true,
            payload: { result: 1 },
        });
        expect(iframe.contentWindow.postedMessages.length).toBe(1);
    });
    it('dispose() removes the message listener — no callbacks after dispose', function () {
        const onReady = vi.fn();
        const iframe = makeIframe();
        const t = createPostMessageTransport({
            iframe: asIframe(iframe),
            onReady,
            onPublish: vi.fn(),
            onCapabilityInvoke: vi.fn(),
        });
        expect(fakeWin.listenerCount).toBe(1);
        t.dispose();
        expect(fakeWin.listenerCount).toBe(0);
        fakeWin.fire({
            data: { kind: 'widget-ready' },
            source: iframe.contentWindow,
        });
        expect(onReady).not.toHaveBeenCalled();
    });
});
