/**
 * Headless dry-run: exercises the widget-host contract end-to-end in a
 * linkedom DOM. Exits 0 with "OK" on success, 1 with a diagnostic on
 * failure. Invoked via `pnpm --filter @atlas/widget-host dry-run`.
 */
import { parseHTML } from 'linkedom';
// --- set up a browser-ish global environment BEFORE importing packages
const dom = parseHTML('<!doctype html><html><head></head><body></body></html>');
// linkedom's window/document types don't match the DOM lib exactly. We
// install them as globals through a typed mutator so the call sites are
// strongly typed even though the underlying mutation crosses a boundary.
interface GlobalInstallSlots {
    window: unknown;
    document: unknown;
    HTMLElement: unknown;
    DocumentFragment: unknown;
    customElements: unknown;
    Node: unknown;
    NodeFilter: unknown;
    structuredClone: unknown;
}
// eslint-disable-next-line atlas-widgets/no-double-cast, @typescript-eslint/no-unsafe-type-assertion -- boundary: linkedom-DOM-shape; installing parsed-DOM objects as globals so subsequent module imports see them.
const g = globalThis as unknown as Partial<GlobalInstallSlots> & Record<string, unknown>;
g.window = dom.window;
g.document = dom.document;
g.HTMLElement = dom.HTMLElement;
g.DocumentFragment = dom.DocumentFragment;
g.customElements = dom.customElements;
g.Node = dom.Node;
// linkedom exposes NodeFilter only on some builds. Probe via a typed
// reader instead of an `as unknown as` chain at the use-site.
function readMaybeNodeFilter(d: unknown): unknown {
    if (typeof d !== 'object' || d === null)
        return undefined;
    const probe: {
        NodeFilter?: unknown;
    } = d as {
        NodeFilter?: unknown;
    };
    return probe.NodeFilter;
}
g.NodeFilter = readMaybeNodeFilter(dom) ?? { SHOW_ELEMENT: 1 };
if (typeof g.structuredClone !== 'function') {
    g.structuredClone = function (v: unknown): unknown {
        return JSON.parse(JSON.stringify(v)) as unknown;
    };
}
// linkedom does not implement createTreeWalker; add a tiny shim so
// @atlas/core's html tagged template can attach event bindings.
interface TreeWalkerLike {
    nextNode: () => Element | null;
}
interface MinimalElement {
    children?: Iterable<MinimalElement>;
}
interface CreateTreeWalkerHost {
    createTreeWalker?: ((root: MinimalElement) => TreeWalkerLike) | unknown;
}
const docForShim: CreateTreeWalkerHost = globalThis.document;
if (typeof docForShim.createTreeWalker !== 'function') {
    docForShim.createTreeWalker = function (root: MinimalElement): TreeWalkerLike {
        const elements: MinimalElement[] = [];
        const walk = function (el: MinimalElement): void {
            elements.push(el);
            for (const child of el.children ?? [])
                walk(child);
        };
        for (const child of root.children ?? [])
            walk(child);
        let i = -1;
        return {
            nextNode(): Element | null {
                i += 1;
                const next = i < elements.length ? elements[i] : undefined;
                if (!next)
                    return null;
                // eslint-disable-next-line atlas-widgets/no-double-cast, @typescript-eslint/no-unsafe-type-assertion -- boundary: linkedom-DOM-shape; treewalker shim returns linkedom element nodes shaped as the DOM Element our consumers expect.
                return next as unknown as Element;
            },
        };
    };
}
// ---- import the package under test (registers <widget-host>) --------
const pkg = await import('../src/index.ts');
const { WidgetRegistry, moduleDefaultRegistry, UndeclaredTopicError, CapabilityDeniedError, } = pkg;
import type { WidgetManifest, WidgetContext } from '../src/types.ts';
import type { WidgetRegistry as WidgetRegistryType } from '../src/registry.ts';
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
        }
        catch (err) {
            this.requestResult = err;
        }
        try {
            await this.context.request('demo.forbidden', {});
            this.forbiddenResult = 'resolved-unexpectedly';
        }
        catch (err) {
            this.forbiddenResult = err;
        }
        try {
            this.context.channel.publish('demo.pinged', { x: 1 });
        }
        catch (err) {
            this.publishError = err;
        }
        try {
            this.context.channel.publish('demo.not-declared', {});
        }
        catch (err) {
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
customElements.define('demo-stub-widget', 
// eslint-disable-next-line atlas-widgets/no-double-cast, @typescript-eslint/no-unsafe-type-assertion -- boundary: linkedom-DOM-shape; customElements.define expects the lib.dom CustomElementConstructor signature, but our StubWidget extends linkedom's HTMLElement which is structurally compatible at runtime.
StubWidget as unknown as CustomElementConstructor);
const registry = new WidgetRegistry();
registry.register({
    manifest,
    // eslint-disable-next-line atlas-widgets/no-double-cast, @typescript-eslint/no-unsafe-type-assertion -- boundary: linkedom-DOM-shape; the registry types its element ctor against lib.dom HTMLElement, but at runtime we register a linkedom-backed subclass.
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
interface WidgetHostElement extends HTMLElement {
    registry: WidgetRegistryType;
    principal: unknown;
    tenantId: string;
    correlationId: string;
    capabilities: Record<string, (args: unknown) => Promise<unknown>>;
    layout: unknown;
}
/** Narrows `document.createElement('widget-host')` to the host element's
 *  surface contract. The lib.dom `createElement` signature returns
 *  `HTMLElement` for unknown tag names; this writes the augmentation
 *  shape in one place so call-sites stay free of escape-hatch casts. */
function createWidgetHostElement(): WidgetHostElement {
    const el = document.createElement('widget-host');
    // Attach the augmentation shape; el is a plain HTMLElement until the
    // host class upgrades it, then these properties are read by the host.
    const capabilities: Record<string, (args: unknown) => Promise<unknown>> = {};
    const seed: Omit<WidgetHostElement, keyof HTMLElement> = {
        registry,
        principal: undefined,
        tenantId: '',
        correlationId: '',
        capabilities,
        layout: undefined,
    };
    return Object.assign(el, seed);
}
interface RequestResult {
    ok?: boolean;
}
function isRequestResult(v: unknown): v is RequestResult {
    return typeof v === 'object' && v !== null;
}
async function main(): Promise<void> {
    // moduleDefaultRegistry is a separate instance; make sure it's empty.
    assert(!moduleDefaultRegistry.has('demo.stub'), 'module default registry should not know demo.stub');
    const host = createWidgetHostElement();
    host.registry = registry;
    host.principal = { id: 'u_test', roles: [] };
    host.tenantId = 't_test';
    host.correlationId = 'cid-dry-run';
    host.capabilities = {
        'demo.noop': async function (): Promise<{
            ok: true;
        }> {
            return ({ ok: true });
        },
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
    const scan = function (node: ChildrenNode | null | undefined): void {
        if (!node || stub)
            return;
        if (node instanceof StubWidget) {
            stub = node;
            return;
        }
        for (const child of node.children ?? [])
            scan(child);
    };
    // The host is structurally a ChildrenNode (HTMLElement has .children);
    // re-typing through a local variable avoids the inline assertion.
    const hostAsChildrenNode: ChildrenNode = host;
    scan(hostAsChildrenNode);
    assert(stub, 'stub widget should be present in host DOM');
    const stubNode: StubWidget = stub;
    // Give the widget's own _runAssertions microtask chain more time.
    await waitMicrotasks(20);
    assert(stubNode.mounted, 'stub.connectedCallback should have run');
    assert(stubNode.assertionsDone, 'stub assertions should complete');
    // 1. demo.noop capability worked.
    const reqResult = stubNode.requestResult;
    assert(isRequestResult(reqResult) && reqResult.ok === true, `demo.noop should resolve with { ok: true }, got ${JSON.stringify(stubNode.requestResult)}`);
    // 2. demo.forbidden rejects with CapabilityDeniedError.
    assert(stubNode.forbiddenResult instanceof CapabilityDeniedError, `demo.forbidden should reject with CapabilityDeniedError, got ${String(stubNode.forbiddenResult)}`);
    // 3. demo.pinged publish succeeded (no error stored).
    assert(stubNode.publishError === null, `demo.pinged should publish cleanly, got ${String(stubNode.publishError)}`);
    // 4. demo.not-declared publish throws UndeclaredTopicError.
    assert(stubNode.undeclaredPublishError instanceof UndeclaredTopicError, `demo.not-declared should throw UndeclaredTopicError, got ${String(stubNode.undeclaredPublishError)}`);
    // 5. Unmount — linkedom fires disconnectedCallback when removed.
    host.remove();
    await waitMicrotasks(5);
    assert(stubNode.onUnmountCalled === true, 'stub.onUnmount should have run during host teardown');
    // eslint-disable-next-line no-console -- harness-diagnostic: dry-run CLI's success report; stdout IS the contract per file header
    console.log('OK');
}
main().catch(function (err: unknown) {
    const stack = err instanceof Error ? (err.stack ?? err.message) : String(err);
    // eslint-disable-next-line no-console -- harness-diagnostic: dry-run CLI's failure report; stderr IS the contract per file header
    console.error('FAIL:', stack);
    process.exit(1);
});
