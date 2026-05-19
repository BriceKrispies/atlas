import { describe, it, expect } from '@atlas/test';
import { assertDefined } from '@atlas/test-fixtures/assert';
import type { LogEvent } from '@atlas/logging';
import type { CollectorSink } from '@atlas/logging';
import { makeTestContext, makeTestRig } from './helpers.ts';
const RESERVED_TOP_LEVEL_KEYS = [
    'timestamp',
    'level',
    'message',
    'eventName',
    'tenantId',
    'principalId',
    'userId',
    'sessionId',
    'moduleId',
    'actionId',
    'resourceType',
    'resourceId',
    'surfaceId',
    'correlationId',
    'causationId',
    'traceId',
    'spanId',
    'requestId',
    'durationMs',
    'error',
    'properties',
];
/** First emitted event — invariant-asserted so callers can read fields. */
function firstEvent(collector: CollectorSink): LogEvent {
    return assertDefined(collector.events[0], 'expected at least one log event in collector');
}
describe('LogEvent schema stability', function () {
    it('emitted event uses ONLY reserved top-level keys', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({ pipeline: rig.pipeline });
        ctx.logger.info('test', {
            event: 'Test.X.Y',
            properties: { nope: 1, another: 2 },
        });
        const e = firstEvent(rig.collector);
        const keys = Object.keys(e);
        for (const k of keys) {
            expect(RESERVED_TOP_LEVEL_KEYS).toContain(k);
        }
    });
    it('caller-supplied data lands under properties, not top level', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({ pipeline: rig.pipeline });
        ctx.logger.info('test', {
            properties: { foo: 'bar', count: 7 },
        });
        const e = firstEvent(rig.collector);
        expect(e.properties).toEqual({ foo: 'bar', count: 7 });
        // The caller-supplied keys must NOT appear at top level. `in` returns
        // a boolean and works against any object — no unsafe cast needed.
        expect('foo' in e).toBe(false);
        expect('count' in e).toBe(false);
    });
    it('absent optional fields are not present in the emitted event', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({ pipeline: rig.pipeline });
        ctx.logger.info('test');
        const e = firstEvent(rig.collector);
        // userId, sessionId, etc. were never set on the context — should be absent.
        expect('userId' in e).toBe(false);
        expect('sessionId' in e).toBe(false);
        expect('causationId' in e).toBe(false);
        expect('moduleId' in e).toBe(false);
        expect('eventName' in e).toBe(false);
        expect('error' in e).toBe(false);
        expect('durationMs' in e).toBe(false);
        expect('properties' in e).toBe(false);
    });
    it('present optional fields are present', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({
            pipeline: rig.pipeline,
            userId: 'u-1',
            sessionId: 's-1',
        })
            .withModule('identity')
            .withAction('Identity.Login')
            .withResource('User', 'u-1')
            .withSurface('admin/login')
            .withCausation('evt-1');
        ctx.logger.error('boom', {
            event: 'Identity.Login.Failed',
            error: { code: 'CRED_INVALID', message: 'bad creds' },
            durationMs: 12,
            properties: { attemptCount: 3 },
        });
        const e = firstEvent(rig.collector);
        expect(e.userId).toBe('u-1');
        expect(e.sessionId).toBe('s-1');
        expect(e.moduleId).toBe('identity');
        expect(e.actionId).toBe('Identity.Login');
        expect(e.resourceType).toBe('User');
        expect(e.resourceId).toBe('u-1');
        expect(e.surfaceId).toBe('admin/login');
        expect(e.causationId).toBe('evt-1');
        expect(e.eventName).toBe('Identity.Login.Failed');
        expect(e.error).toEqual({ code: 'CRED_INVALID', message: 'bad creds' });
        expect(e.durationMs).toBe(12);
        expect(e.properties).toEqual({ attemptCount: 3 });
    });
    it('lines serialize as valid JSON (no embedded raw newlines in string values)', function () {
        const rig = makeTestRig();
        const ctx = makeTestContext({ pipeline: rig.pipeline });
        ctx.logger.info('multi\nline\nmessage', {
            properties: { trace: 'one\ntwo' },
        });
        const e = firstEvent(rig.collector);
        const serialized = JSON.stringify(e);
        // Round-trip parses back without throwing. JSON.parse returns unknown
        // and we don't read the result — the assertion is that the operation
        // succeeds, so discard the value.
        expect(function () {
            JSON.parse(serialized);
        }).not.toThrow();
        // Once stringified, the embedded newlines are escaped.
        expect(serialized.includes('\n')).toBe(false); // no raw newlines in JSON
        expect(serialized.includes('\\n')).toBe(true); // escaped
    });
});
