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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    if (type !== 'message') return;
    this.listeners.push(cb);
  }
  removeEventListener(type: string, cb: (e: FakeMessageEvent) => void): void {
    if (type !== 'message') return;
    this.listeners = this.listeners.filter((l) => l !== cb);
  }
  fire(ev: FakeMessageEvent): void {
    for (const l of [...this.listeners]) l(ev);
  }
  get listenerCount(): number {
    return this.listeners.length;
  }
}

interface FakeIframe {
  contentWindow: { postedMessages: unknown[]; postMessage: (m: unknown) => void };
}

function makeIframe(): FakeIframe {
  const messages: unknown[] = [];
  const win = {
    postedMessages: messages,
    postMessage: (m: unknown) => {
      messages.push(m);
    },
  };
  return { contentWindow: win };
}

let prevWindow: unknown;
let fakeWin: FakeWindow;

beforeEach(() => {
  fakeWin = new FakeWindow();
  prevWindow = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = fakeWin;
});

afterEach(() => {
  if (prevWindow !== undefined) {
    (globalThis as { window?: unknown }).window = prevWindow;
  } else {
    delete (globalThis as { window?: unknown }).window;
  }
});

describe('createPostMessageTransport — source filter', () => {
  it('ignores messages whose event.source is not the iframe.contentWindow', () => {
    const onReady = vi.fn();
    const iframe = makeIframe();
    createPostMessageTransport({
      iframe: iframe as unknown as HTMLIFrameElement,
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

  it('accepts messages whose event.source matches iframe.contentWindow', () => {
    const onReady = vi.fn();
    const iframe = makeIframe();
    createPostMessageTransport({
      iframe: iframe as unknown as HTMLIFrameElement,
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

describe('createPostMessageTransport — malformed envelopes', () => {
  it('drops non-object data', () => {
    const onReady = vi.fn();
    const iframe = makeIframe();
    createPostMessageTransport({
      iframe: iframe as unknown as HTMLIFrameElement,
      onReady,
      onPublish: vi.fn(),
      onCapabilityInvoke: vi.fn(),
    });
    fakeWin.fire({ data: 'not-an-object', source: iframe.contentWindow });
    fakeWin.fire({ data: null, source: iframe.contentWindow });
    fakeWin.fire({ data: 42, source: iframe.contentWindow });
    expect(onReady).not.toHaveBeenCalled();
  });

  it('drops messages with unknown kinds', () => {
    const onReady = vi.fn();
    const onPublish = vi.fn();
    const onCapabilityInvoke = vi.fn();
    const onLog = vi.fn();
    const iframe = makeIframe();
    createPostMessageTransport({
      iframe: iframe as unknown as HTMLIFrameElement,
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

  it('drops messages with no kind field', () => {
    const onReady = vi.fn();
    const iframe = makeIframe();
    createPostMessageTransport({
      iframe: iframe as unknown as HTMLIFrameElement,
      onReady,
      onPublish: vi.fn(),
      onCapabilityInvoke: vi.fn(),
    });
    fakeWin.fire({ data: { foo: 'bar' }, source: iframe.contentWindow });
    expect(onReady).not.toHaveBeenCalled();
  });
});

describe('createPostMessageTransport — message dispatch', () => {
  it('routes "publish" envelopes to onPublish with topic + payload', () => {
    const onPublish = vi.fn();
    const iframe = makeIframe();
    createPostMessageTransport({
      iframe: iframe as unknown as HTMLIFrameElement,
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

  it('routes "capability.invoke" envelopes to onCapabilityInvoke with id+capability+payload', () => {
    const onCapabilityInvoke = vi.fn();
    const iframe = makeIframe();
    createPostMessageTransport({
      iframe: iframe as unknown as HTMLIFrameElement,
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

describe('createPostMessageTransport — log envelope (LogEnvelope)', () => {
  it('routes kind: "log" to onLog when present, normalising level + args', () => {
    const onLog = vi.fn();
    const iframe = makeIframe();
    createPostMessageTransport({
      iframe: iframe as unknown as HTMLIFrameElement,
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
    const arg = onLog.mock.calls[0]![0] as {
      level: string;
      args: string[];
    };
    expect(arg.level).toBe('warn');
    // Args are coerced to string per the contract.
    expect(arg.args[0]).toBe('oops');
    expect(typeof arg.args[1]).toBe('string');
  });

  it('coerces unknown level values to "info"', () => {
    const onLog = vi.fn();
    const iframe = makeIframe();
    createPostMessageTransport({
      iframe: iframe as unknown as HTMLIFrameElement,
      onReady: vi.fn(),
      onPublish: vi.fn(),
      onCapabilityInvoke: vi.fn(),
      onLog,
    });
    fakeWin.fire({
      data: { kind: 'log', level: 'fatal', args: ['x'] },
      source: iframe.contentWindow,
    });
    expect(onLog.mock.calls[0]![0].level).toBe('info');
  });

  it('drops "log" envelopes silently when onLog is not provided', () => {
    const iframe = makeIframe();
    createPostMessageTransport({
      iframe: iframe as unknown as HTMLIFrameElement,
      onReady: vi.fn(),
      onPublish: vi.fn(),
      onCapabilityInvoke: vi.fn(),
      // no onLog
    });
    expect(() =>
      fakeWin.fire({
        data: { kind: 'log', level: 'info', args: ['x'] },
        source: iframe.contentWindow,
      }),
    ).not.toThrow();
  });
});

describe('createPostMessageTransport — send + dispose', () => {
  it('send() forwards an envelope to iframe.contentWindow.postMessage', () => {
    const iframe = makeIframe();
    const t = createPostMessageTransport({
      iframe: iframe as unknown as HTMLIFrameElement,
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

  it('dispose() removes the message listener — no callbacks after dispose', () => {
    const onReady = vi.fn();
    const iframe = makeIframe();
    const t = createPostMessageTransport({
      iframe: iframe as unknown as HTMLIFrameElement,
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

