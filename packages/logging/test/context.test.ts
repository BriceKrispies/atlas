import { describe, it, expect } from 'vitest';
import { makeTestContext, makeTestRig } from './helpers.ts';
import { assertDefined } from '@atlas/test-fixtures/assert';
/** Boundary readback: every event the collector captures conforms to
 *  `LogEvent`, but the "no leak" assertion checks for keys *outside* that
 *  type. Centralise the index-signature widening here so individual call
 *  sites stay clean. */
function asLooseRecord(v: object): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: widening a typed object so an arbitrary "leakage" key can be probed without the structural narrowing the cast would imply.
    return v as Record<string, unknown>;
}
describe('AtlasExecutionContext basics', function () {
    it('emits a LogEvent with mandatory fields stamped from ctx', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({
            pipeline: rig.pipeline,
            tenantId: 'acme',
            principalId: 'u-42',
            incomingCorrelationId: 'corr-fixed',
        });
        ctx.logger.info('hello');
        const e = assertDefined(rig.collector.events[0], 'first emitted event');
        expect(e.tenantId).toBe('acme');
        expect(e.principalId).toBe('u-42');
        expect(e.correlationId).toBe('corr-fixed');
        expect(e.traceId).toBe('corr-fixed'); // defaults to correlationId
        expect(e.spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(e.level).toBe('info');
        expect(e.message).toBe('hello');
        expect(e.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        // environment lives on the context, not on LogEvent — should not leak in.
        expect(asLooseRecord(e)['environment']).toBeUndefined();
    });
    it('generates a correlationId when none is supplied', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({ pipeline: rig.pipeline });
        ctx.logger.info('hi');
        const e = assertDefined(rig.collector.events[0], 'first emitted event');
        expect(e.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
    it('preserves an inbound correlationId', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({
            pipeline: rig.pipeline,
            incomingCorrelationId: 'inbound-123',
        });
        ctx.logger.info('hi');
        expect(assertDefined(rig.collector.events[0], 'first emitted event').correlationId).toBe('inbound-123');
    });
    it('rejects invalid inbound correlation ids and generates instead', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({
            pipeline: rig.pipeline,
            incomingCorrelationId: 'evil\nheader-injection', // contains newline
        });
        ctx.logger.info('hi');
        const e = assertDefined(rig.collector.events[0], 'first emitted event');
        expect(e.correlationId).not.toContain('\n');
        expect(e.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/);
    });
    it('caller properties land under properties — never overwrite reserved fields', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({
            pipeline: rig.pipeline,
            tenantId: 'real',
            principalId: 'real-user',
        });
        ctx.logger.info('hi', {
            properties: {
                tenantId: 'fake',
                principalId: 'fake-user',
                correlationId: 'fake-corr',
                anything: 'else',
            },
        });
        const e = assertDefined(rig.collector.events[0], 'first emitted event');
        expect(e.tenantId).toBe('real');
        expect(e.principalId).toBe('real-user');
        expect(e.correlationId).not.toBe('fake-corr');
        // The caller's keys live under properties unchanged.
        expect(e.properties).toEqual({
            tenantId: 'fake',
            principalId: 'fake-user',
            correlationId: 'fake-corr',
            anything: 'else',
        });
    });
    it('event field maps to LogEvent.eventName', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({ pipeline: rig.pipeline });
        ctx.logger.info('deploy started', { event: 'Compute.Deploy.Started' });
        expect(assertDefined(rig.collector.events[0], 'first emitted event').eventName).toBe('Compute.Deploy.Started');
    });
    it('error and durationMs map to top-level fields', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({ pipeline: rig.pipeline });
        ctx.logger.error('boom', {
            error: { code: 'BOOM', message: 'kaboom' },
            durationMs: 42,
        });
        const e = assertDefined(rig.collector.events[0], 'first emitted event');
        expect(e.error).toEqual({ code: 'BOOM', message: 'kaboom' });
        expect(e.durationMs).toBe(42);
    });
    it('optional ctx fields appear when set', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({
            pipeline: rig.pipeline,
            userId: 'u-real',
            sessionId: 's-real',
        });
        ctx.logger.info('hi');
        const e = assertDefined(rig.collector.events[0], 'first emitted event');
        expect(e.userId).toBe('u-real');
        expect(e.sessionId).toBe('s-real');
    });
    it('all five log levels emit', function () {
        const rig = makeTestRig({ defaultLevel: 'debug' });
        const ctx = makeTestContext({ pipeline: rig.pipeline });
        ctx.logger.debug('a');
        ctx.logger.info('b');
        ctx.logger.warn('c');
        ctx.logger.error('d');
        ctx.logger.fatal('e');
        expect(rig.collector.events.map(function (x) {
            return x.level;
        })).toEqual([
            'debug',
            'info',
            'warn',
            'error',
            'fatal',
        ]);
    });
});
