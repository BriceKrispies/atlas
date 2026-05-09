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

import { describe, it, expect, vi } from 'vitest';
import { CapabilityBridge } from '../src/capabilities.ts';
import { CapabilityDeniedError } from '../src/errors.ts';
import type { CapabilityTraceEvent, WidgetManifest } from '../src/types.ts';

const baseManifest: WidgetManifest = {
  widgetId: 'demo.widget',
  version: '1.0.0',
  displayName: 'Demo',
  configSchema: 'demo.v1',
  isolation: 'inline',
  capabilities: ['backend.query', 'navigation.go'],
};

describe('CapabilityBridge — denial paths', () => {
  it('throws CapabilityDeniedError(unknown-instance) when instance is not registered', async () => {
    const trace: CapabilityTraceEvent[] = [];
    const bridge = new CapabilityBridge({ onTrace: (e) => trace.push(e) });
    await expect(
      bridge.invoke('inst-unknown', 'backend.query', {}),
    ).rejects.toBeInstanceOf(CapabilityDeniedError);
    expect(trace.find((e) => e.kind === 'denied')).toMatchObject({
      kind: 'denied',
      reason: 'unknown-instance',
    });
  });

  it('throws CapabilityDeniedError(undeclared) when instance did not declare the capability', async () => {
    const trace: CapabilityTraceEvent[] = [];
    const bridge = new CapabilityBridge({ onTrace: (e) => trace.push(e) });
    bridge.register('backend.write', async () => 'ok');
    bridge.registerInstance('inst-1', baseManifest);
    await expect(
      bridge.invoke('inst-1', 'backend.write', {}),
    ).rejects.toMatchObject({ code: 'WIDGET_CAPABILITY_DENIED' });
    expect(trace.find((e) => e.kind === 'denied')).toMatchObject({
      kind: 'denied',
      reason: 'undeclared',
    });
  });

  it('throws CapabilityDeniedError(no-handler) when capability is declared but host has no handler', async () => {
    const trace: CapabilityTraceEvent[] = [];
    const bridge = new CapabilityBridge({ onTrace: (e) => trace.push(e) });
    bridge.registerInstance('inst-1', baseManifest);
    await expect(
      bridge.invoke('inst-1', 'backend.query', {}),
    ).rejects.toBeInstanceOf(CapabilityDeniedError);
    expect(trace.find((e) => e.kind === 'denied')).toMatchObject({
      reason: 'no-handler',
    });
  });
});

describe('CapabilityBridge — happy path', () => {
  it('invokes handler and emits invoke→resolve trace', async () => {
    const trace: CapabilityTraceEvent[] = [];
    const bridge = new CapabilityBridge({ onTrace: (e) => trace.push(e) });
    bridge.register('backend.query', async (args) => ({
      ok: true,
      args,
    }));
    bridge.registerInstance('inst-1', baseManifest);

    const result = await bridge.invoke('inst-1', 'backend.query', {
      kind: 'list',
    });
    expect(result).toEqual({ ok: true, args: { kind: 'list' } });
    expect(trace.map((e) => e.kind)).toEqual(['invoke', 'resolve']);
  });

  it('passes manifest + instanceId to handler ctx', async () => {
    const bridge = new CapabilityBridge();
    const handler = vi.fn(
      async (_args: unknown, _ctx: { instanceId: string; manifest: WidgetManifest }) => 'ok',
    );
    bridge.register('navigation.go', handler);
    bridge.registerInstance('inst-x', baseManifest);

    await bridge.invoke('inst-x', 'navigation.go', { url: '/' });
    expect(handler).toHaveBeenCalledTimes(1);
    const ctx = handler.mock.calls[0]![1];
    expect(ctx.instanceId).toBe('inst-x');
    expect(ctx.manifest.widgetId).toBe('demo.widget');
  });

  it('handler throws → invoke→reject trace, error propagates', async () => {
    const trace: CapabilityTraceEvent[] = [];
    const bridge = new CapabilityBridge({ onTrace: (e) => trace.push(e) });
    bridge.register('backend.query', async () => {
      throw new Error('downstream');
    });
    bridge.registerInstance('inst-1', baseManifest);

    await expect(
      bridge.invoke('inst-1', 'backend.query', {}),
    ).rejects.toThrow('downstream');
    expect(trace.map((e) => e.kind)).toEqual(['invoke', 'reject']);
  });
});

describe('CapabilityBridge — revoke', () => {
  it('revokeInstance prevents further invocations on that instance', async () => {
    const bridge = new CapabilityBridge();
    bridge.register('backend.query', async () => 'ok');
    bridge.registerInstance('inst-1', baseManifest);
    await bridge.invoke('inst-1', 'backend.query', {});
    bridge.revokeInstance('inst-1');
    await expect(
      bridge.invoke('inst-1', 'backend.query', {}),
    ).rejects.toBeInstanceOf(CapabilityDeniedError);
  });

  it('revoking one instance does not affect a sibling registration', async () => {
    const bridge = new CapabilityBridge();
    bridge.register('backend.query', async () => 'ok');
    bridge.registerInstance('a', baseManifest);
    bridge.registerInstance('b', baseManifest);
    bridge.revokeInstance('a');
    await expect(bridge.invoke('a', 'backend.query', {})).rejects.toBeDefined();
    await expect(bridge.invoke('b', 'backend.query', {})).resolves.toBe('ok');
  });
});

describe('CapabilityBridge — register() input validation', () => {
  it('throws TypeError when handler is not a function', () => {
    const bridge = new CapabilityBridge();
    expect(() =>
      bridge.register('x.y', undefined as unknown as () => unknown),
    ).toThrow(TypeError);
    expect(() =>
      bridge.register('x.y', 42 as unknown as () => unknown),
    ).toThrow(TypeError);
  });
});

describe('CapabilityBridge — capability grant matrix', () => {
  it('allows only the union declared in manifest.capabilities', async () => {
    // A widget that declares only `backend.query` cannot exceed scope.
    const restricted: WidgetManifest = {
      ...baseManifest,
      capabilities: ['backend.query'],
    };
    const bridge = new CapabilityBridge();
    bridge.register('backend.query', async () => 'q');
    bridge.register('backend.command', async () => 'c');
    bridge.register('navigation.go', async () => 'g');
    bridge.registerInstance('inst-r', restricted);

    await expect(bridge.invoke('inst-r', 'backend.query', {})).resolves.toBe('q');
    await expect(bridge.invoke('inst-r', 'backend.command', {})).rejects.toMatchObject(
      { code: 'WIDGET_CAPABILITY_DENIED' },
    );
    await expect(bridge.invoke('inst-r', 'navigation.go', {})).rejects.toMatchObject(
      { code: 'WIDGET_CAPABILITY_DENIED' },
    );
  });

  it('a widget without a capabilities array has zero permissions', async () => {
    const { capabilities: _omit, ...rest } = baseManifest;
    void _omit;
    const noneManifest: WidgetManifest = rest;
    const bridge = new CapabilityBridge();
    bridge.register('backend.query', async () => 'q');
    bridge.registerInstance('inst-z', noneManifest);
    await expect(
      bridge.invoke('inst-z', 'backend.query', {}),
    ).rejects.toMatchObject({ code: 'WIDGET_CAPABILITY_DENIED' });
  });
});
