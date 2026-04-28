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

// linkedom's window/document types don't match the DOM lib exactly; we
// cast through `unknown` to install them as globals for the duration of
// the test.
const g = globalThis as unknown as Record<string, unknown>;
g['window'] = dom.window;
g['document'] = dom.document;
g['HTMLElement'] = dom.HTMLElement;
g['DocumentFragment'] = dom.DocumentFragment;
g['customElements'] = dom.customElements;
g['Node'] = dom.Node;
const linkedomNodeFilter = (dom as unknown as { NodeFilter?: unknown })
  .NodeFilter;
g['NodeFilter'] = linkedomNodeFilter ?? { SHOW_ELEMENT: 1 };
if (typeof g['structuredClone'] !== 'function') {
  g['structuredClone'] = (v: unknown): unknown =>
    JSON.parse(JSON.stringify(v)) as unknown;
}

// linkedom does not implement createTreeWalker; add a tiny shim so
// @atlas/core's html tagged template can attach event bindings.
interface TreeWalkerLike {
  nextNode: () => Element | null;
}
interface MinimalElement {
  children?: Iterable<MinimalElement>;
}
if (
  typeof (globalThis.document as unknown as {
    createTreeWalker?: unknown;
  }).createTreeWalker !== 'function'
) {
  (
    globalThis.document as unknown as {
      createTreeWalker: (root: MinimalElement) => TreeWalkerLike;
    }
  ).createTreeWalker = (root: MinimalElement): TreeWalkerLike => {
    const elements: Element[] = [];
    const walk = (el: MinimalElement): void => {
      elements.push(el as unknown as Element);
      for (const child of el.children ?? []) walk(child);
    };
    for (const child of root.children ?? []) walk(child);
    let i = -1;
    return {
      nextNode(): Element | null {
        i += 1;
        return i < elements.length ? (elements[i] ?? null) : null;
      },
    };
  };
}

// ---- import the package under test (registers <widget-host>) --------
const pkg = await import('../src/index.ts');
const {
  WidgetRegistry,
  moduleDefaultRegistry,
  UndeclaredTopicError,
  CapabilityDeniedError,
} = pkg;

import type { WidgetManifest, WidgetContext } from '../src/types.ts';

// A stub widget extending AtlasSurface. We can't meaningfully exercise
// AtlasSurface's reactive render() in linkedom, so we extend the raw
// HTMLElement instead — the host-element only cares that it can `new`
// the class, set properties, and append it. It still behaves like a
// widget for the purposes of this contract test.
const HTMLElementCtor = globalThis.HTMLElement;

class StubWidget extends HTMLElementCtor {
  mounted: boolean = false;
  unmounted: boolean = false;
  onUnmountCalled: boolean = false;
  assertionsDone: boolean = false;
  requestResult: unknown = null;
  forbiddenResult: unknown = null;
  publishError: unknown = null;
  undeclaredPublishError: unknown = null;

  context!: WidgetContext;
  config?: Record<string, unknown>;
  instanceId?: string;

  constructor() {
    super();
  }

  connectedCallback(): void {
    this.mounted = true;
    // Fire and forget — test reads the promises after a microtask.
    void this._runAssertions();
  }

  disconnectedCallback(): void {
    this.mounted = false;
    this.unmounted = true;
  }

  async _runAssertions(): Promise<void> {
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

  onUnmount(): void {
    this.onUnmountCalled = true;
  }
}

// linkedom's customElements.define exists but connectedCallback is not
// automatically triggered on appendChild in all versions. We invoke it
// manually via the host-element's mount path.
const manifest: WidgetManifest = {
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
customElements.define(
  'demo-stub-widget',
  StubWidget as unknown as CustomElementConstructor,
);

const registry = new WidgetRegistry();
registry.register({
  manifest,
  element: StubWidget as unknown as new () => HTMLElement,
});

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`assertion failed: ${msg}`);
  }
}

async function waitMicrotasks(n: number = 5): Promise<void> {
  for (let i = 0; i < n; i++) {
    await Promise.resolve();
  }
}

async function main(): Promise<void> {
  // moduleDefaultRegistry is a separate instance; make sure it's empty.
  assert(
    !moduleDefaultRegistry.has('demo.stub'),
    'module default registry should not know demo.stub',
  );

  const host = document.createElement('widget-host') as HTMLElement & {
    registry: typeof registry;
    principal: unknown;
    tenantId: string;
    correlationId: string;
    capabilities: Record<string, (args: unknown) => Promise<unknown>>;
    layout: unknown;
  };
  host.registry = registry;
  host.principal = { id: 'u_test', roles: [] };
  host.tenantId = 't_test';
  host.correlationId = 'cid-dry-run';
  host.capabilities = {
    'demo.noop': async (): Promise<{ ok: true }> => ({ ok: true }),
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

  // Fallback: find by instance tracking
  let stub: StubWidget | null = null;
  interface ChildrenNode {
    children?: Iterable<ChildrenNode>;
  }
  const scan = (node: ChildrenNode | null | undefined): void => {
    if (!node || stub) return;
    if (node instanceof StubWidget) {
      stub = node;
      return;
    }
    for (const child of node.children ?? []) scan(child);
  };
  scan(host as unknown as ChildrenNode);

  assert(stub, 'stub widget should be present in host DOM');
  const stubNode: StubWidget = stub;
  // Give the widget's own _runAssertions microtask chain more time.
  await waitMicrotasks(20);
  assert(stubNode.mounted, 'stub.connectedCallback should have run');
  assert(stubNode.assertionsDone, 'stub assertions should complete');

  // 1. demo.noop capability worked.
  const reqResult = stubNode.requestResult as { ok?: boolean } | null;
  assert(
    reqResult !== null && reqResult?.ok === true,
    `demo.noop should resolve with { ok: true }, got ${JSON.stringify(stubNode.requestResult)}`,
  );

  // 2. demo.forbidden rejects with CapabilityDeniedError.
  assert(
    stubNode.forbiddenResult instanceof CapabilityDeniedError,
    `demo.forbidden should reject with CapabilityDeniedError, got ${String(stubNode.forbiddenResult)}`,
  );

  // 3. demo.pinged publish succeeded (no error stored).
  assert(
    stubNode.publishError === null,
    `demo.pinged should publish cleanly, got ${String(stubNode.publishError)}`,
  );

  // 4. demo.not-declared publish throws UndeclaredTopicError.
  assert(
    stubNode.undeclaredPublishError instanceof UndeclaredTopicError,
    `demo.not-declared should throw UndeclaredTopicError, got ${String(stubNode.undeclaredPublishError)}`,
  );

  // 5. Unmount — linkedom fires disconnectedCallback when removed.
  host.remove();
  await waitMicrotasks(5);
  assert(
    stubNode.onUnmountCalled === true,
    'stub.onUnmount should have run during host teardown',
  );

  console.log('OK');
}

main().catch((err: unknown) => {
  const stack =
    err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error('FAIL:', stack);
  process.exit(1);
});
