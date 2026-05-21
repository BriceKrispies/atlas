/**
 * CapabilityBridge tests — INV-WIDGET-03 (a widget may only invoke
 * capabilities declared in its manifest).
 *
 * Coverage:
 *   - invocation against an unknown instance is denied
 *   - invocation of an undeclared capability is denied
 *   - invocation of a known but unhandled capability is denied
 *   - declared capability with handler resolves, trace receives
 *     invoke→resolve
 *   - handler throw → trace receives invoke→reject and error propagates
 *   - revokeInstance disables further invocations
 *   - register() validates handler typeof is function
 *   - onTrace errors are caught and routed via emitTelemetry (no throw)
 */
import { describe, it, expect, vi } from '@atlas/test';
import { CapabilityBridge } from '../src/capabilities.ts';
import { CapabilityDeniedError } from '../src/errors.ts';
import type { CapabilityTraceEvent, WidgetManifest } from '../src/types.ts';
import { assertDefined } from '@atlas/test-fixtures/assert';
const baseManifest: WidgetManifest = {
    widgetId: 'demo.widget',
    version: '1.0.0',
    displayName: 'Demo',
    configSchema: 'demo.v1',
    isolation: 'inline',
    capabilities: ['backend.query', 'navigation.go'],
};
describe('CapabilityBridge — denial paths', function () {
    it('throws CapabilityDeniedError(unknown-instance) when instance is not registered', async function () {
        const trace: CapabilityTraceEvent[] = [];
        const bridge = new CapabilityBridge({ onTrace: function (e) {
                return trace.push(e);
            } });
        await expect(bridge.invoke('inst-unknown', 'backend.query', {})).rejects.toBeInstanceOf(CapabilityDeniedError);
        expect(trace.find(function (e) {
            return e.kind === 'denied';
        })).toMatchObject({
            kind: 'denied',
            reason: 'unknown-instance',
        });
    });
    it('throws CapabilityDeniedError(undeclared) when instance did not declare the capability', async function () {
        const trace: CapabilityTraceEvent[] = [];
        const bridge = new CapabilityBridge({ onTrace: function (e) {
                return trace.push(e);
            } });
        bridge.register('backend.write', async function () {
            return 'ok';
        });
        bridge.registerInstance('inst-1', baseManifest);
        await expect(bridge.invoke('inst-1', 'backend.write', {})).rejects.toMatchObject({ code: 'WIDGET_CAPABILITY_DENIED' });
        expect(trace.find(function (e) {
            return e.kind === 'denied';
        })).toMatchObject({
            kind: 'denied',
            reason: 'undeclared',
        });
    });
    it('throws CapabilityDeniedError(no-handler) when capability is declared but host has no handler', async function () {
        const trace: CapabilityTraceEvent[] = [];
        const bridge = new CapabilityBridge({ onTrace: function (e) {
                return trace.push(e);
            } });
        bridge.registerInstance('inst-1', baseManifest);
        await expect(bridge.invoke('inst-1', 'backend.query', {})).rejects.toBeInstanceOf(CapabilityDeniedError);
        expect(trace.find(function (e) {
            return e.kind === 'denied';
        })).toMatchObject({
            reason: 'no-handler',
        });
    });
});
describe('CapabilityBridge — happy path', function () {
    it('invokes handler and emits invoke→resolve trace', async function () {
        const trace: CapabilityTraceEvent[] = [];
        const bridge = new CapabilityBridge({ onTrace: function (e) {
                return trace.push(e);
            } });
        bridge.register('backend.query', async function (args) {
            return ({
                ok: true,
                args,
            });
        });
        bridge.registerInstance('inst-1', baseManifest);
        const result = await bridge.invoke('inst-1', 'backend.query', {
            kind: 'list',
        });
        expect(result).toEqual({ ok: true, args: { kind: 'list' } });
        expect(trace.map(function (e) {
            return e.kind;
        })).toEqual(['invoke', 'resolve']);
    });
    it('passes manifest + instanceId to handler ctx', async function () {
        const bridge = new CapabilityBridge();
        const handler = vi.fn(async function (_args: unknown, _ctx: {
            instanceId: string;
            manifest: WidgetManifest;
        }) {
            return 'ok';
        });
        bridge.register('navigation.go', handler);
        bridge.registerInstance('inst-x', baseManifest);
        await bridge.invoke('inst-x', 'navigation.go', { url: '/' });
        expect(handler).toHaveBeenCalledTimes(1);
        const firstCall = assertDefined(handler.mock.calls[0], 'handler must have been invoked exactly once');
        const ctx = firstCall[1];
        expect(ctx.instanceId).toBe('inst-x');
        expect(ctx.manifest.widgetId).toBe('demo.widget');
    });
    it('handler throws → invoke→reject trace, error propagates', async function () {
        const trace: CapabilityTraceEvent[] = [];
        const bridge = new CapabilityBridge({ onTrace: function (e) {
                return trace.push(e);
            } });
        bridge.register('backend.query', async function () {
            throw new Error('downstream');
        });
        bridge.registerInstance('inst-1', baseManifest);
        await expect(bridge.invoke('inst-1', 'backend.query', {})).rejects.toThrow('downstream');
        expect(trace.map(function (e) {
            return e.kind;
        })).toEqual(['invoke', 'reject']);
    });
});
describe('CapabilityBridge — revoke', function () {
    it('revokeInstance prevents further invocations on that instance', async function () {
        const bridge = new CapabilityBridge();
        bridge.register('backend.query', async function () {
            return 'ok';
        });
        bridge.registerInstance('inst-1', baseManifest);
        await bridge.invoke('inst-1', 'backend.query', {});
        bridge.revokeInstance('inst-1');
        await expect(bridge.invoke('inst-1', 'backend.query', {})).rejects.toBeInstanceOf(CapabilityDeniedError);
    });
    it('revoking one instance does not affect a sibling registration', async function () {
        const bridge = new CapabilityBridge();
        bridge.register('backend.query', async function () {
            return 'ok';
        });
        bridge.registerInstance('a', baseManifest);
        bridge.registerInstance('b', baseManifest);
        bridge.revokeInstance('a');
        await expect(bridge.invoke('a', 'backend.query', {})).rejects.toBeDefined();
        await expect(bridge.invoke('b', 'backend.query', {})).resolves.toBe('ok');
    });
});
describe('CapabilityBridge — register() input validation', function () {
    it('throws TypeError when handler is not a function', function () {
        const bridge = new CapabilityBridge();
        // Adversarial test fixture: feed invalid runtime values (undefined / number)
        // to assert the runtime typeof-function guard fires. The double-cast is
        // unavoidable because the test is verifying the runtime check exists for
        // callers that bypass TypeScript (JS consumers, dynamic imports).
        expect(function () {
            return bridge.register('x.y', undefined as unknown as () => unknown);
        }).toThrow(TypeError);
        expect(function () {
            return bridge.register('x.y', 42 as unknown as () => unknown);
        }).toThrow(TypeError);
    });
});
describe('CapabilityBridge — capability grant matrix', function () {
    it('allows only the union declared in manifest.capabilities', async function () {
        // A widget that declares only `backend.query` cannot exceed scope.
        const restricted: WidgetManifest = {
            ...baseManifest,
            capabilities: ['backend.query'],
        };
        const bridge = new CapabilityBridge();
        bridge.register('backend.query', async function () {
            return 'q';
        });
        bridge.register('backend.command', async function () {
            return 'c';
        });
        bridge.register('navigation.go', async function () {
            return 'g';
        });
        bridge.registerInstance('inst-r', restricted);
        await expect(bridge.invoke('inst-r', 'backend.query', {})).resolves.toBe('q');
        await expect(bridge.invoke('inst-r', 'backend.command', {})).rejects.toMatchObject({ code: 'WIDGET_CAPABILITY_DENIED' });
        await expect(bridge.invoke('inst-r', 'navigation.go', {})).rejects.toMatchObject({ code: 'WIDGET_CAPABILITY_DENIED' });
    });
    it('a widget without a capabilities array has zero permissions', async function () {
        const { capabilities: _omit, ...rest } = baseManifest;
        void _omit;
        const noneManifest: WidgetManifest = rest;
        const bridge = new CapabilityBridge();
        bridge.register('backend.query', async function () {
            return 'q';
        });
        bridge.registerInstance('inst-z', noneManifest);
        await expect(bridge.invoke('inst-z', 'backend.query', {})).rejects.toMatchObject({ code: 'WIDGET_CAPABILITY_DENIED' });
    });
});
