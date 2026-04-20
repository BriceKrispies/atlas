/**
 * Headless dry-run: exercises the widget-host contract end-to-end in a
 * linkedom DOM. Exits 0 with "OK" on success, 1 with a diagnostic on
 * failure. Invoked via `pnpm --filter @atlas/widget-host dry-run`.
 */

import { parseHTML } from 'linkedom';

// --- set up a browser-ish global environment BEFORE importing packages
const dom = parseHTML(
  '<!doctype html><html><head></head><body></body></html>',
);
globalThis.window = dom.window;
globalThis.document = dom.document;
globalThis.HTMLElement = dom.HTMLElement;
globalThis.DocumentFragment = dom.DocumentFragment;
globalThis.customElements = dom.customElements;
globalThis.Node = dom.Node;
globalThis.NodeFilter = dom.NodeFilter ?? {
  SHOW_ELEMENT: 1,
};
if (!globalThis.structuredClone) {
  globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v));
}

// linkedom does not implement createTreeWalker; add a tiny shim so
// @atlas/core's html tagged template can attach event bindings.
if (typeof globalThis.document.createTreeWalker !== 'function') {
  globalThis.document.createTreeWalker = (root) => {
    const elements = [];
    const walk = (el) => {
      elements.push(el);
      for (const child of el.children ?? []) walk(child);
    };
    for (const child of root.children ?? []) walk(child);
    let i = -1;
    return {
      nextNode() {
        i += 1;
        return i < elements.length ? elements[i] : null;
      },
    };
  };
}

// ---- import the package under test (registers <widget-host>) --------
const pkg = await import('../src/index.js');
const {
  WidgetRegistry,
  moduleDefaultRegistry,
  UndeclaredTopicError,
  CapabilityDeniedError,
} = pkg;

// A stub widget extending AtlasSurface. We can't meaningfully exercise
// AtlasSurface's reactive render() in linkedom, so we extend the raw
// HTMLElement instead — the host-element only cares that it can `new`
// the class, set properties, and append it. It still behaves like a
// widget for the purposes of this contract test.
class StubWidget extends globalThis.HTMLElement {
  constructor() {
    super();
    this.mounted = false;
    this.requestResult = null;
    this.publishError = null;
    this.undeclaredPublishError = null;
  }

  connectedCallback() {
    this.mounted = true;
    // Fire and forget — test reads the promises after a microtask.
    this._runAssertions();
  }

  disconnectedCallback() {
    this.mounted = false;
    this.unmounted = true;
  }

  async _runAssertions() {
    try {
      this.requestResult = await this.context.request('demo.noop', {});
    } catch (err) {
      this.requestResult = err;
    }
    try {
      await this.context.request('demo.forbidden', {});
      this.forbiddenResult = 'resolved-unexpectedly';
    } catch (err) {
      this.forbiddenResult = err;
    }
    try {
      this.context.channel.publish('demo.pinged', { x: 1 });
    } catch (err) {
      this.publishError = err;
    }
    try {
      this.context.channel.publish('demo.not-declared', {});
    } catch (err) {
      this.undeclaredPublishError = err;
    }
    this.assertionsDone = true;
  }

  onUnmount() {
    this.onUnmountCalled = true;
  }
}

// linkedom's customElements.define exists but connectedCallback is not
// automatically triggered on appendChild in all versions. We invoke it
// manually via the host-element's mount path.
const manifest = {
  widgetId: 'demo.stub',
  version: '1.0.0',
  displayName: 'Stub',
  configSchema: 'ui.widget.stub.config.v1',
  isolation: 'inline',
  capabilities: ['demo.noop'],
  provides: { topics: ['demo.pinged'] },
  consumes: { topics: ['demo.pong'] },
};

// linkedom requires any HTMLElement subclass to be registered via
// customElements.define before `new`. Real browsers do not require this
// for classes that extend HTMLElement but aren't meant to be parsed from
// markup; we register a tag here purely to satisfy the headless DOM.
customElements.define('demo-stub-widget', StubWidget);

const registry = new WidgetRegistry();
registry.register({ manifest, element: StubWidget });

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`assertion failed: ${msg}`);
  }
}

async function waitMicrotasks(n = 5) {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
}

async function main() {
  // moduleDefaultRegistry is a separate instance; make sure it's empty.
  assert(
    !moduleDefaultRegistry.has('demo.stub'),
    'module default registry should not know demo.stub',
  );

  const host = document.createElement('widget-host');
  host.registry = registry;
  host.principal = { id: 'u_test', roles: [] };
  host.tenantId = 't_test';
  host.correlationId = 'cid-dry-run';
  host.capabilities = {
    'demo.noop': async () => ({ ok: true }),
  };
  host.layout = {
    version: 1,
    slots: {
      main: [{ widgetId: 'demo.stub', instanceId: 'w-001', config: {} }],
    },
  };
  document.body.appendChild(host);
  // linkedom fires connectedCallback on append; no manual call needed.

  // Allow the mount Promise chain + the widget's assertion micro-loop
  // to settle.
  await waitMicrotasks(20);

  // Dig the StubWidget out of the host's light DOM.
  const widget = host.querySelector('[data-widget-instance-id="w-001"]')
    ?.querySelector?.('*')
    ?? host.querySelector('section[data-slot="main"]')?.children?.[0]?.children?.[0];

  // Fallback: find by instance tracking
  let stub = null;
  const scan = (node) => {
    if (!node || stub) return;
    if (node instanceof StubWidget) {
      stub = node;
      return;
    }
    for (const child of node.children ?? []) scan(child);
  };
  scan(host);

  assert(stub, 'stub widget should be present in host DOM');
  // Give the widget's own _runAssertions microtask chain more time.
  await waitMicrotasks(20);
  assert(stub.mounted, 'stub.connectedCallback should have run');
  assert(stub.assertionsDone, 'stub assertions should complete');

  // 1. demo.noop capability worked.
  assert(
    stub.requestResult && stub.requestResult.ok === true,
    `demo.noop should resolve with { ok: true }, got ${JSON.stringify(stub.requestResult)}`,
  );

  // 2. demo.forbidden rejects with CapabilityDeniedError.
  assert(
    stub.forbiddenResult instanceof CapabilityDeniedError,
    `demo.forbidden should reject with CapabilityDeniedError, got ${stub.forbiddenResult}`,
  );

  // 3. demo.pinged publish succeeded (no error stored).
  assert(
    stub.publishError === null,
    `demo.pinged should publish cleanly, got ${stub.publishError}`,
  );

  // 4. demo.not-declared publish throws UndeclaredTopicError.
  assert(
    stub.undeclaredPublishError instanceof UndeclaredTopicError,
    `demo.not-declared should throw UndeclaredTopicError, got ${stub.undeclaredPublishError}`,
  );

  // 5. Unmount — linkedom fires disconnectedCallback when removed.
  host.remove();
  await waitMicrotasks(5);
  assert(
    stub.onUnmountCalled === true,
    'stub.onUnmount should have run during host teardown',
  );

  console.log('OK');
}

main().catch((err) => {
  console.error('FAIL:', err?.stack ?? err);
  process.exit(1);
});
