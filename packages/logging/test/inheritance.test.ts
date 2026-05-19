import { describe, it, expect } from 'vitest';
import { assertDefined } from '@atlas/test-fixtures/assert';
import { makeTestContext, makeTestRig } from './helpers.ts';
describe('AtlasExecutionContext inheritance — immutable .with*()', function () {
    it('with() returns a new context; parent is untouched', function () {
        const rig = makeTestRig();
        const parent = makeTestContext({ pipeline: rig.pipeline });
        const child = parent.with({ moduleId: 'identity' });
        expect(parent.moduleId).toBeUndefined();
        expect(child.moduleId).toBe('identity');
        expect(child).not.toBe(parent);
    });
    it('correlationId / traceId / tenantId are immutable across .with()', function () {
        const rig = makeTestRig();
        const parent = makeTestContext({
            pipeline: rig.pipeline,
            tenantId: 'acme',
            incomingCorrelationId: 'corr-1',
        });
        const child = parent.with({ moduleId: 'identity' });
        expect(child.tenantId).toBe(parent.tenantId);
        expect(child.correlationId).toBe(parent.correlationId);
        expect(child.traceId).toBe(parent.traceId);
    });
    it('withModule sets moduleId, leaves everything else', function () {
        const rig = makeTestRig();
        const parent = makeTestContext({ pipeline: rig.pipeline }).withCausation('cause-1');
        const child = parent.withModule('identity');
        expect(child.moduleId).toBe('identity');
        expect(child.causationId).toBe('cause-1');
    });
    it('withAction sets actionId', function () {
        const rig = makeTestRig();
        const child = makeTestContext({ pipeline: rig.pipeline }).withAction('Identity.Login');
        expect(child.actionId).toBe('Identity.Login');
    });
    it('withResource sets resourceType and resourceId together', function () {
        const rig = makeTestRig();
        const child = makeTestContext({ pipeline: rig.pipeline }).withResource('User', 'u-1');
        expect(child.resourceType).toBe('User');
        expect(child.resourceId).toBe('u-1');
    });
    it('withSurface sets surfaceId', function () {
        const rig = makeTestRig();
        const child = makeTestContext({ pipeline: rig.pipeline }).withSurface('admin/pages');
        expect(child.surfaceId).toBe('admin/pages');
    });
    it('withCausation sets causationId', function () {
        const rig = makeTestRig();
        const child = makeTestContext({ pipeline: rig.pipeline }).withCausation('evt-1');
        expect(child.causationId).toBe('evt-1');
    });
    it('childSpan() generates a fresh spanId; correlationId / traceId preserved', function () {
        const rig = makeTestRig();
        const parent = makeTestContext({
            pipeline: rig.pipeline,
            incomingCorrelationId: 'corr-1',
        });
        const child = parent.childSpan('subtask');
        expect(child.spanId).not.toBe(parent.spanId);
        expect(child.spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(child.correlationId).toBe(parent.correlationId);
        expect(child.traceId).toBe(parent.traceId);
    });
    it('inherited contexts get a fresh logger that stamps the new fields', function () {
        const rig = makeTestRig();
        const parent = makeTestContext({ pipeline: rig.pipeline });
        const child = parent.withModule('identity').withAction('Identity.Login');
        parent.logger.info('parent log');
        child.logger.info('child log');
        expect(rig.collector.events).toHaveLength(2);
        const [first, second] = [
            assertDefined(rig.collector.events[0], 'events[0] exists (length asserted === 2)'),
            assertDefined(rig.collector.events[1], 'events[1] exists (length asserted === 2)'),
        ];
        expect(first.moduleId).toBeUndefined();
        expect(first.actionId).toBeUndefined();
        expect(second.moduleId).toBe('identity');
        expect(second.actionId).toBe('Identity.Login');
    });
    it('chained inheritance compounds without losing earlier fields', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({ pipeline: rig.pipeline })
            .withModule('catalog')
            .withAction('Catalog.SeedPackage.Apply')
            .withResource('SeedPackage', 'pkg-42')
            .withCausation('evt-7');
        expect(ctx.moduleId).toBe('catalog');
        expect(ctx.actionId).toBe('Catalog.SeedPackage.Apply');
        expect(ctx.resourceType).toBe('SeedPackage');
        expect(ctx.resourceId).toBe('pkg-42');
        expect(ctx.causationId).toBe('evt-7');
    });
    it('explicitly passing undefined clears an optional field', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({
            pipeline: rig.pipeline,
            userId: 'u-1',
        });
        expect(ctx.userId).toBe('u-1');
        const cleared = ctx.with({ userId: undefined });
        expect(cleared.userId).toBeUndefined();
    });
});
