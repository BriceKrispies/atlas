import { describe, it, expect } from '@atlas/test';
import { InMemoryLevelController } from '../src/index.ts';
import { makeTestContext, makeTestRig } from './helpers.ts';
describe('LevelController — InMemoryLevelController precedence', function () {
    it('falls back to default when nothing is set', function () {
        const c = new InMemoryLevelController('warn');
        expect(c.resolve({})).toBe('warn');
    });
    it('global override beats default', function () {
        const c = new InMemoryLevelController('info');
        c.setGlobal('error');
        expect(c.resolve({})).toBe('error');
    });
    it('module override beats global', function () {
        const c = new InMemoryLevelController('info');
        c.setGlobal('error');
        c.setModule('identity', 'debug');
        expect(c.resolve({ moduleId: 'identity' })).toBe('debug');
        expect(c.resolve({ moduleId: 'other' })).toBe('error');
    });
    it('tenant override beats module', function () {
        const c = new InMemoryLevelController('info');
        c.setModule('identity', 'debug');
        c.setTenant('acme', 'warn');
        expect(c.resolve({ moduleId: 'identity', tenantId: 'acme' })).toBe('warn');
        expect(c.resolve({ moduleId: 'identity', tenantId: 'other' })).toBe('debug');
    });
    it('correlation override beats tenant', function () {
        const c = new InMemoryLevelController('info');
        c.setTenant('acme', 'warn');
        c.setCorrelation('corr-1', 'debug');
        expect(c.resolve({ tenantId: 'acme', correlationId: 'corr-1' })).toBe('debug');
        expect(c.resolve({ tenantId: 'acme', correlationId: 'corr-2' })).toBe('warn');
    });
    it('null clears an override', function () {
        const c = new InMemoryLevelController('info');
        c.setModule('identity', 'debug');
        expect(c.resolve({ moduleId: 'identity' })).toBe('debug');
        c.setModule('identity', null);
        expect(c.resolve({ moduleId: 'identity' })).toBe('info');
    });
    it('snapshot reflects the current state', function () {
        const c = new InMemoryLevelController('info');
        c.setGlobal('warn');
        c.setModule('identity', 'debug');
        c.setTenant('acme', 'error');
        c.setCorrelation('corr-1', 'fatal');
        const snap = c.snapshot();
        expect(snap.default).toBe('info');
        expect(snap.global).toBe('warn');
        expect(snap.byModule).toEqual({ identity: 'debug' });
        expect(snap.byTenant).toEqual({ acme: 'error' });
        expect(snap.byCorrelation).toEqual({ 'corr-1': 'fatal' });
    });
});
describe('LevelController — runtime filtering through ctx.logger', function () {
    it('debug calls are filtered when global is info', function () {
        const rig = makeTestRig({ defaultLevel: 'info' });
        const ctx = makeTestContext({ pipeline: rig.pipeline });
        ctx.logger.debug('skipped');
        ctx.logger.info('kept');
        expect(rig.collector.events.map(function (e) {
            return e.level;
        })).toEqual(['info']);
    });
    it('correlation override flips a single flow to debug', function () {
        const rig = makeTestRig({ defaultLevel: 'warn' });
        const ctxA = makeTestContext({ pipeline: rig.pipeline, incomingCorrelationId: 'corr-A' });
        const ctxB = makeTestContext({ pipeline: rig.pipeline, incomingCorrelationId: 'corr-B' });
        rig.levelController.setCorrelation('corr-A', 'debug');
        ctxA.logger.debug('flow A debug — kept');
        ctxA.logger.info('flow A info — kept');
        ctxB.logger.debug('flow B debug — dropped');
        ctxB.logger.info('flow B info — dropped (warn-and-above)');
        ctxB.logger.warn('flow B warn — kept');
        const messages = rig.collector.events.map(function (e) {
            return e.message;
        });
        expect(messages).toEqual([
            'flow A debug — kept',
            'flow A info — kept',
            'flow B warn — kept',
        ]);
    });
    it('module override flips one module noisier than the rest', function () {
        const rig = makeTestRig({ defaultLevel: 'warn' });
        rig.levelController.setModule('catalog', 'debug');
        const ctxId = makeTestContext({ pipeline: rig.pipeline }).withModule('identity');
        const ctxCat = makeTestContext({ pipeline: rig.pipeline }).withModule('catalog');
        ctxId.logger.debug('id-debug — dropped');
        ctxCat.logger.debug('cat-debug — kept');
        expect(rig.collector.events.map(function (e) {
            return e.message;
        })).toEqual(['cat-debug — kept']);
    });
    it('fatal bypasses level filtering', function () {
        const rig = makeTestRig({ defaultLevel: 'fatal' });
        const ctx = makeTestContext({ pipeline: rig.pipeline });
        ctx.logger.error('error — dropped'); // below fatal, dropped
        ctx.logger.fatal('fatal — kept');
        expect(rig.collector.events.map(function (e) {
            return e.level;
        })).toEqual(['fatal']);
    });
});
