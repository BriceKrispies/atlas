/**
 * Unit tests for AuditExport configuration handlers (Layer 1).
 * Combined: `Identity.AuditExport.{Configure, Activate, Disable}`.
 *
 * Notable invariants: singleton-per-tenant config (id `audex:<tenantId>`);
 * destination must carry either keys OR roleArn auth; every event
 * carries `retentionTag: 'retention:1y'` for the config audit trail.
 */
import { describe, it, expect } from '@atlas/test';
import { handleAuditExportConfigure, handleAuditExportActivate, handleAuditExportDisable, IdentityError, identityErrorCodes, } from '../../src/index.ts';
import { newFixture, dispatchAll } from '../lib/fixtures.ts';
const VALID_DEST = {
    kind: 's3' as const,
    bucket: 'atlas-audit-exports',
    region: 'us-east-1',
    pathPrefix: 'tenant-1/',
    accessKeyId: 'AKIAFAKE',
    secretAccessKey: 'fake-secret',
};
describe('handleAuditExportConfigure', function () {
    it('emits AuditExportConfigured with retention:1y and exact cache tags', async function () {
        const fx = newFixture();
        const result = await handleAuditExportConfigure({
            tenantId: fx.tenantId,
            correlationId: 'corr-1',
            principalId: 'admin',
            destination: VALID_DEST,
            cadence: 'daily',
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.AuditExportConfigured');
        expect(result.envelope.retentionTag).toBe('retention:1y');
        expect(result.envelope.cacheInvalidationTags).toEqual([
            `Tenant:${fx.tenantId}`,
            `AuditExportConfig:audex:${fx.tenantId}`,
        ]);
        expect(result.document.configId).toBe(`audex:${fx.tenantId}`);
        expect(result.document.status).toBe('configured');
    });
    it('updates the singleton config when called a second time (preserves status)', async function () {
        const fx = newFixture();
        const first = await handleAuditExportConfigure({
            tenantId: fx.tenantId,
            correlationId: 'first',
            principalId: 'admin',
            destination: VALID_DEST,
            cadence: 'daily',
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        const second = await handleAuditExportConfigure({
            tenantId: fx.tenantId,
            correlationId: 'second',
            principalId: 'admin',
            destination: { ...VALID_DEST, region: 'eu-west-1' },
            cadence: 'hourly',
        }, fx.events, fx.entities);
        expect(second.document.configId).toBe(first.document.configId);
        expect(second.document.destination.region).toBe('eu-west-1');
        expect(second.document.cadence).toBe('hourly');
    });
    it('accepts roleArn-only auth (no access keys)', async function () {
        const fx = newFixture();
        const result = await handleAuditExportConfigure({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            destination: {
                kind: 's3',
                bucket: 'b',
                region: 'us-east-1',
                roleArn: 'arn:aws:iam::123:role/atlas-audit',
            },
            cadence: 'daily',
        }, fx.events, fx.entities);
        expect(result.document.destination.roleArn).toBe('arn:aws:iam::123:role/atlas-audit');
    });
    it('rejects destination missing bucket or region with AUDIT_EXPORT_DEST_INVALID', async function () {
        const fx = newFixture();
        await expect(handleAuditExportConfigure({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            destination: { kind: 's3', bucket: '', region: 'us-east-1', roleArn: 'arn' },
            cadence: 'daily',
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.AUDIT_EXPORT_DEST_INVALID,
        });
        expect(fx.events.events).toHaveLength(0);
    });
    it('rejects destination with no auth (no keys, no roleArn)', async function () {
        const fx = newFixture();
        await expect(handleAuditExportConfigure({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            destination: { kind: 's3', bucket: 'b', region: 'us-east-1' },
            cadence: 'daily',
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.AUDIT_EXPORT_DEST_INVALID,
        });
    });
    it('persists retentionFilter when provided', async function () {
        const fx = newFixture();
        const result = await handleAuditExportConfigure({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            destination: VALID_DEST,
            cadence: 'daily',
            retentionFilter: ['retention:7y', 'retention:10y'],
        }, fx.events, fx.entities);
        expect(result.document.retentionFilter).toEqual([
            'retention:7y',
            'retention:10y',
        ]);
    });
});
describe('handleAuditExportActivate', function () {
    async function configure(fx: ReturnType<typeof newFixture>) {
        const r = await handleAuditExportConfigure({
            tenantId: fx.tenantId,
            correlationId: 's',
            principalId: 'admin',
            destination: VALID_DEST,
            cadence: 'daily',
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        return r.document;
    }
    it('flips status to active and emits AuditExportActivated', async function () {
        const fx = newFixture();
        const cfg = await configure(fx);
        const result = await handleAuditExportActivate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            configId: cfg.configId,
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.AuditExportActivated');
        expect(result.envelope.retentionTag).toBe('retention:1y');
        expect(result.document.status).toBe('active');
    });
    it('rejects unknown configId with AUDIT_EXPORT_NOT_FOUND', async function () {
        const fx = newFixture();
        await expect(handleAuditExportActivate({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            configId: 'audex:fake',
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.AUDIT_EXPORT_NOT_FOUND,
        });
    });
});
describe('handleAuditExportDisable', function () {
    it('flips status to disabled and emits AuditExportDisabled', async function () {
        const fx = newFixture();
        const cfgResult = await handleAuditExportConfigure({
            tenantId: fx.tenantId,
            correlationId: 's',
            principalId: 'admin',
            destination: VALID_DEST,
            cadence: 'daily',
        }, fx.events, fx.entities);
        await dispatchAll(fx);
        const result = await handleAuditExportDisable({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            configId: cfgResult.document.configId,
        }, fx.events, fx.entities);
        expect(result.envelope.eventType).toBe('Identity.AuditExportDisabled');
        expect(result.document.status).toBe('disabled');
    });
    it('rejects unknown configId with AUDIT_EXPORT_NOT_FOUND', async function () {
        const fx = newFixture();
        await expect(handleAuditExportDisable({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            configId: 'audex:fake',
        }, fx.events, fx.entities)).rejects.toMatchObject({
            code: identityErrorCodes.AUDIT_EXPORT_NOT_FOUND,
        });
    });
    it('throws IdentityError for rejection', async function () {
        const fx = newFixture();
        await expect(handleAuditExportDisable({
            tenantId: fx.tenantId,
            correlationId: 'c',
            principalId: 'admin',
            configId: 'audex:fake',
        }, fx.events, fx.entities)).rejects.toBeInstanceOf(IdentityError);
    });
});
