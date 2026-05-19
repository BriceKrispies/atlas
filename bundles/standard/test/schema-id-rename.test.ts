/**
 * Regression test for tickets/archive/chore/schema-id-normalization-sweep.md
 * (commit bd30daf): the 11 canonical schemas under specs/schemas/contracts/
 * + their duplicated copies under packages/page-templates/src/schemas/ +
 * packages/widget-host/src/schemas/ were renamed from
 *   `https://atlas-platform.example.com/schemas/<name>.v<n>.json`
 * to bare short-form `<name>.v<n>`.
 *
 * The page-templates `validatePageDocument` flow is load-bearing: it
 * constructs its own AJV instance and registers `page_layout.schema.json`
 * so the `$ref` inside `page_document.schema.json` can resolve. If anyone
 * reverts the `$id` on either side (canonical → long URL, or the
 * duplicated copy diverges), the cross-schema ref breaks and seed pages
 * fail validation.
 *
 * This test pins:
 *   1. The duplicated copies' `$id`s match the short-form contract.
 *   2. The intra-schema `$ref` inside page_document uses the short form.
 *   3. `validatePageDocument` accepts a document containing a regions map
 *      with a WidgetInstance entry — exercising the ref resolution path
 *      that breaks first if either rename regresses.
 *
 * Adversarial frame: an alias re-introduction in `packages/schemas/src/
 * loader.ts` would not save us — page-templates uses its own AJV, not the
 * central loader. The duplicated-copy `$id` is the single source of truth
 * for this path.
 */
import { test, expect } from '@atlas/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
interface JsonSchema {
    $id?: string;
    properties?: {
        regions?: {
            additionalProperties?: {
                items?: {
                    $ref?: string;
                };
            };
        };
    };
}
/**
 * Read + parse a JSON Schema file from disk. JSON.parse is typed as
 * `any`; the read schemas conform to the structural-only `JsonSchema`
 * interface above (every field optional). The narrow is local to this
 * regression suite — we don't validate the schemas themselves, only
 * the `$id` + `$ref` fields they declare.
 */
async function readSchemaFile(path: string): Promise<JsonSchema> {
    const text = await readFile(path, 'utf8');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: JSON Schema fixture read — file shape is a JSON Schema with the optional fields declared in `JsonSchema` above; every field accessed by the assertions is optional, so a malformed file surfaces as a failed `expect`, not a runtime crash.
    return JSON.parse(text) as JsonSchema;
}
test('regression: page-layout.v1 + page-document.v1 duplicated $ids match short-form contract', async function () {
    const pageLayoutPath = resolve(repoRoot, 'packages', 'page-templates', 'src', 'schemas', 'page_layout.schema.json');
    const pageDocPath = resolve(repoRoot, 'packages', 'page-templates', 'src', 'schemas', 'page_document.schema.json');
    const pageLayout = await readSchemaFile(pageLayoutPath);
    const pageDoc = await readSchemaFile(pageDocPath);
    expect(pageLayout.$id, 'page_layout duplicated copy must declare short-form $id').toBe('page-layout.v1');
    expect(pageDoc.$id, 'page_document duplicated copy must declare short-form $id').toBe('page-document.v1');
    const ref = pageDoc.properties?.regions?.additionalProperties?.items?.$ref;
    expect(ref, 'page_document.regions.<region>.items.$ref must use short-form page-layout.v1#...').toBe('page-layout.v1#/definitions/WidgetInstance');
});
test('regression: validatePageDocument resolves the page-layout.v1 $ref (rename did not break cross-schema lookup)', async function () {
    const { validatePageDocument } = await import('@atlas/page-templates');
    // Minimal-but-realistic page document that exercises a WidgetInstance
    // entry inside a region — the path that fails first if the $ref resolution
    // regresses (e.g. someone reverts the $id on the duplicated page_layout
    // copy without restoring the long URL in the page_document $ref).
    const doc = {
        pageId: 'page-1',
        tenantId: 'tenant-1',
        templateId: 'template.one-column',
        templateVersion: '0.1.0',
        status: 'draft',
        regions: {
            main: [
                {
                    widgetId: 'widget.announcements',
                    instanceId: 'instance-1',
                    config: {},
                },
            ],
        },
    };
    const result = validatePageDocument(doc);
    expect(result.ok, `valid doc should pass; errors: ${JSON.stringify(result.errors)}`).toBe(true);
});
test('regression: canonical specs/schemas/contracts/page-layout.v1 + page-document.v1 use short-form $ids', async function () {
    // Pins the canonical schemas so the duplicated copies + canonical
    // never drift on the $id contract. If anyone reverts the canonical
    // back to the long URL, this fires before downstream consumers
    // notice silently-stale duplicates.
    const pageLayoutPath = resolve(repoRoot, 'specs', 'schemas', 'contracts', 'page_layout.schema.json');
    const pageDocPath = resolve(repoRoot, 'specs', 'schemas', 'contracts', 'page_document.schema.json');
    const pageLayout = await readSchemaFile(pageLayoutPath);
    const pageDoc = await readSchemaFile(pageDocPath);
    expect(pageLayout.$id).toBe('page-layout.v1');
    expect(pageDoc.$id).toBe('page-document.v1');
    expect(pageDoc.properties?.regions?.additionalProperties?.items?.$ref).toBe('page-layout.v1#/definitions/WidgetInstance');
});
