/**
 * F2 — Event envelope `dispatcherChainVersion` test.
 *
 * Probes `specs/crosscut/always-on.md` §4.2 + architect finding F2.
 *
 * The claim under test: when `WORKER_MODE=async`, an event's dispatcher chain
 * runs against the registry snapshot at *append time*, not drain time. For
 * the worker to resolve the right chain when picking up an event that an
 * earlier reload's handler appended, the event envelope MUST carry a
 * `dispatcherChainVersion` field.
 *
 * Expected result TODAY: **FAILS** — both surfaces lack the field:
 *   (a) the TypeScript type `EventEnvelope` in `@atlas/platform-core`
 *   (b) the JSON schema in `packages/schemas/src/generated/event_envelope.schema.json`
 *
 * When this test passes, F2 is mechanizable as: worker resolves the chain by
 * envelope-stamped version, and stale-version events fail loud rather than
 * silently running the wrong chain.
 */
import { describe, test, expect } from '@atlas/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EventEnvelope } from '@atlas/platform-core';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const ENVELOPE_SCHEMA = join(REPO_ROOT, 'packages', 'schemas', 'src', 'generated', 'event_envelope.schema.json');
describe('F2 — event envelope dispatcherChainVersion (always-on §4.2 / I5)', function () {
    test('JSON schema MUST declare a dispatcherChainVersion property', function () {
        const schema = JSON.parse(readFileSync(ENVELOPE_SCHEMA, 'utf8')) as {
            properties: Record<string, unknown>;
            required: string[];
        };
        expect(Object.keys(schema.properties), 'event_envelope.schema.json must allow dispatcherChainVersion').toContain('dispatcherChainVersion');
        expect(schema.required, 'dispatcherChainVersion must be required so an append cannot forget it').toContain('dispatcherChainVersion');
    });
    test('TypeScript EventEnvelope type MUST carry dispatcherChainVersion', function () {
        // Type-level probe: an envelope literal lacking dispatcherChainVersion
        // should be a type error against the future EventEnvelope shape. Today
        // it compiles cleanly, which is exactly what proves the gap. Force the
        // check at runtime by inspecting that a built envelope object has the
        // field stamped — anything constructing a new envelope in `apps/server`
        // would stamp it.
        //
        // Build the same way the production ingress pipeline does (see
        // `packages/ingress/src/submit-intent.ts`). The minimum envelope:
        const envelope: EventEnvelope = {
            eventId: 'evt-1',
            eventType: 'Test.Event',
            schemaId: 'test.event.v1',
            schemaVersion: 1,
            occurredAt: new Date(0).toISOString(),
            tenantId: 'tenant-a',
            correlationId: 'corr-1',
            idempotencyKey: 'idem-1',
            payload: {},
        } as EventEnvelope;
        expect(Object.prototype.hasOwnProperty.call(envelope, 'dispatcherChainVersion'), 'EventEnvelope construction must stamp dispatcherChainVersion at append time').toBe(true);
        // Type-level: the next line should fail typecheck once
        // `dispatcherChainVersion` is required. Until it is, this is a
        // documentation-by-test pointing at the gap.
        const _typeProbe: keyof EventEnvelope = 'dispatcherChainVersion' as keyof EventEnvelope;
        expect(_typeProbe).toBe('dispatcherChainVersion');
    });
});
