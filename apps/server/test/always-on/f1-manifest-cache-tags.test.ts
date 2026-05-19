/**
 * F1 — Manifest cache-tag declaration test.
 *
 * Probes `specs/crosscut/always-on.md` §4.3 + architect finding F1.
 *
 * The claim under test: for hot-reload to preserve I10 (event-driven cache
 * invalidation), a module's manifest MUST declare which `cacheInvalidationTags`
 * each event type carries. Without this, a reload can swap in a handler that
 * silently drops a tag and the manifest check at reload-admission cannot catch
 * it.
 *
 * Expected result TODAY: **FAILS** — `specs/schemas/contracts/module_manifest.schema.json`
 * defines an `eventContract` with no place for cache tags, and the bundled
 * manifests in `packages/schemas/src/generated/manifests/*.manifest.json`
 * have `events: []` and `cacheArtifacts: []` for the modules whose handlers
 * actually emit tagged events (`content-pages` is the obvious case — its
 * dispatcher emits tags via `cacheInvalidationTags` on every primary event).
 *
 * When this test passes, F1 is mechanizable at the reload boundary.
 */
import { describe, test, expect } from '@atlas/test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const MANIFEST_DIR = join(REPO_ROOT, 'packages', 'schemas', 'src', 'generated', 'manifests');
const MANIFEST_SCHEMA = join(REPO_ROOT, 'specs', 'schemas', 'contracts', 'module_manifest.schema.json');
interface EventContract {
    eventType: string;
    category: string;
    schemaId: string;
    compatibility: string;
    cacheInvalidationTags?: unknown; // The field this test claims should exist
}
interface ModuleManifest {
    moduleId: string;
    events?: {
        publishes?: EventContract[];
        consumes?: EventContract[];
    } | EventContract[];
    cacheArtifacts?: unknown[];
}
function loadManifests(): ModuleManifest[] {
    return readdirSync(MANIFEST_DIR)
        .filter(function (f) {
        return f.endsWith('.manifest.json');
    })
        .map(function (f) {
        return JSON.parse(readFileSync(join(MANIFEST_DIR, f), 'utf8')) as ModuleManifest;
    });
}
describe('F1 — manifest cache-tag declaration (always-on §4.3 / I10)', function () {
    test('module_manifest schema MUST require cacheInvalidationTags on every event contract', function () {
        // The schema is the contract for what a manifest can declare. If the
        // schema has no slot for per-event cache tags, the reload-admission
        // mechanism (always-on §4.3) cannot enforce I10 by manifest check.
        const schema = JSON.parse(readFileSync(MANIFEST_SCHEMA, 'utf8')) as {
            $defs: {
                eventContract: {
                    properties: Record<string, unknown>;
                    required?: string[];
                };
            };
        };
        const eventContractProps = schema.$defs.eventContract.properties;
        const eventContractRequired = schema.$defs.eventContract.required ?? [];
        expect(Object.keys(eventContractProps), 'eventContract schema must allow a cacheInvalidationTags property').toContain('cacheInvalidationTags');
        expect(eventContractRequired, 'cacheInvalidationTags must be required so a module cannot omit it silently').toContain('cacheInvalidationTags');
    });
    test('every bundled manifest event contract carries cacheInvalidationTags', function () {
        const manifests = loadManifests();
        expect(manifests.length, 'fixture sanity: manifests must load').toBeGreaterThan(0);
        const violations: Array<{
            module: string;
            eventType: string;
            reason: string;
        }> = [];
        for (const m of manifests) {
            const eventsRaw = m.events;
            // Manifests in the repo use BOTH shapes today: `events: []` (array)
            // and `events: { publishes: [], consumes: [] }` (object). Accept either.
            const publishes: EventContract[] = Array.isArray(eventsRaw)
                ? eventsRaw
                : (eventsRaw?.publishes ?? []);
            for (const ev of publishes) {
                if (!('cacheInvalidationTags' in ev)) {
                    violations.push({
                        module: m.moduleId,
                        eventType: ev.eventType,
                        reason: 'no cacheInvalidationTags field on event contract',
                    });
                    continue;
                }
                if (!Array.isArray(ev.cacheInvalidationTags) || ev.cacheInvalidationTags.length === 0) {
                    violations.push({
                        module: m.moduleId,
                        eventType: ev.eventType,
                        reason: 'cacheInvalidationTags is not a non-empty array',
                    });
                }
            }
        }
        expect(violations, `Manifests must declare cacheInvalidationTags for every emitted event. ` +
            `Violations (always-on §4.3 / I10): ${JSON.stringify(violations, null, 2)}`).toEqual([]);
    });
});
