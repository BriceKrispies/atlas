import { InMemoryPageStore, ValidatingPageStore, ContentPageElement, presetLayouts, LayoutRegistry, InMemoryLayoutStore, ValidatingLayoutStore, validateLayoutDocument, validatePageDocument, type LayoutDocument, type PageDocument, } from '@atlas/page-templates';
import { seedPages, gallerySeedPages } from '@atlas/bundle-standard/seed-pages';
export interface SeedPageDoc {
    pageId: string;
    templateId?: string;
    layoutId?: string;
    meta?: {
        title?: string;
        slug?: string;
    };
    [k: string]: unknown;
}
/**
 * Boundary: the bundle ships preset layouts as `ReadonlyArray<unknown>`
 * (JSON-imported documents). Run each through `validateLayoutDocument` so
 * a bad shape fails fast at boot instead of mid-render, then concentrate
 * the typed-factory cast for the rest of the file to consume.
 */
function toLayoutDocuments(raw: ReadonlyArray<unknown>): LayoutDocument[] {
    const out: LayoutDocument[] = [];
    for (const entry of raw) {
        const result = validateLayoutDocument(entry);
        if (!result.ok) {
            throw new Error(`authoring stores: invalid bundled layout — ${result.errors.map(function (e) {
                return `${e.path}: ${e.message}`;
            }).join('; ')}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: validator just passed; bundle-imported JSON
        out.push(entry as LayoutDocument);
    }
    return out;
}
/**
 * Boundary: walk the bundle's `ReadonlyArray<unknown>` seed pages, run
 * each through `validatePageDocument`, and emit typed entries shaped for
 * the page store. The validator is the trust boundary; the typed-factory
 * cast on a verified value follows.
 */
function toPageDocuments(raw: ReadonlyArray<unknown>): PageDocument[] {
    const out: PageDocument[] = [];
    for (const entry of raw) {
        const result = validatePageDocument(entry);
        if (!result.ok) {
            throw new Error(`authoring stores: invalid bundled page document — ${result.errors.map(function (e) {
                return `${e.path}: ${e.message}`;
            }).join('; ')}`);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary: validator just passed; bundle-imported JSON
        out.push(entry as PageDocument);
    }
    return out;
}
export const authoringLayoutRegistry = new LayoutRegistry();
for (const layout of toLayoutDocuments(presetLayouts)) {
    authoringLayoutRegistry.register(layout);
}
export const authoringLayoutStore = new ValidatingLayoutStore(new InMemoryLayoutStore(Object.fromEntries(toLayoutDocuments(presetLayouts).map(function (l) {
    return [l.layoutId, l];
}))));
export const authoringPageStore = new ValidatingPageStore(new InMemoryPageStore());
for (const doc of toPageDocuments(seedPages)) {
    void authoringPageStore.save(doc.pageId, doc);
}
/**
 * Picker entry for the gallery — just enough for the layout-select to
 * label and resolve each preset. Built from the validated `PageDocument`
 * (titles read off `meta` via a typed guard) so the gallery never has to
 * cast the raw JSON shape itself.
 */
export interface GalleryPagePickerEntry {
    pageId: string;
    templateId?: string;
    title?: string;
}
function readMetaTitle(meta: unknown): string | undefined {
    if (meta === null || typeof meta !== 'object')
        return undefined;
    // `Reflect.get` returns `unknown` so the field read doesn't require a
    // structural narrowing of `meta` itself.
    const t: unknown = Reflect.get(meta, 'title');
    return typeof t === 'string' ? t : undefined;
}
export const galleryPickerEntries: ReadonlyArray<GalleryPagePickerEntry> = toPageDocuments(gallerySeedPages).map(function (doc) {
    const entry: GalleryPagePickerEntry = { pageId: doc.pageId };
    if (typeof doc.templateId === 'string')
        entry.templateId = doc.templateId;
    const title = readMetaTitle(doc['meta']);
    if (title !== undefined)
        entry.title = title;
    return entry;
});
for (const doc of toPageDocuments(gallerySeedPages)) {
    void authoringPageStore.save(doc.pageId, doc);
}
export const authoringCapabilities: Record<string, (args: unknown) => Promise<unknown>> = {
    'backend.query': async function (args: unknown) {
        const { path } = (args ?? {}) as {
            path?: string;
        };
        if (typeof path === 'string' && path.startsWith('/media/files/')) {
            const fileId = path.slice('/media/files/'.length);
            return {
                id: fileId,
                filename: `${fileId}.png`,
                url: 'https://placehold.co/600x200?text=Sample+Media',
            };
        }
        return null;
    },
};
interface ContentPageMountConfig {
    pageId: string;
    edit: boolean;
}
/**
 * Read the demo `config` bag (loosely-typed `Record<string, unknown>`
 * coming from the specimen harness) into the typed
 * `ContentPageMountConfig` shape the mount path needs. Validates that
 * `pageId` is a non-empty string and coerces `edit` to a boolean.
 */
function readMountConfig(config: Record<string, unknown>): ContentPageMountConfig {
    const pageIdRaw = config['pageId'];
    if (typeof pageIdRaw !== 'string' || pageIdRaw.length === 0) {
        throw new Error('mountContentPage: config.pageId must be a non-empty string');
    }
    return { pageId: pageIdRaw, edit: config['edit'] === true };
}
export function mountContentPage(demoEl: HTMLElement, ctx: {
    config: Record<string, unknown>;
    onLog: (kind: string, payload: unknown) => void;
}): () => void {
    const { config, onLog } = ctx;
    const { pageId, edit } = readMountConfig(config);
    // Constructing the element via `new` (instead of `document.createElement`)
    // preserves the typed `ContentPageElement` shape — registry-defined
    // custom elements upgrade either way, and this lets the property writes
    // below typecheck without a structural cast.
    const page = new ContentPageElement();
    page.pageId = pageId;
    page.pageStore = authoringPageStore;
    page.layoutRegistry = authoringLayoutRegistry;
    page.principal = { id: 'u_authoring', roles: [] };
    page.tenantId = 'acme';
    page.correlationId = `cid-authoring-${pageId}-${Date.now()}`;
    page.capabilities = authoringCapabilities;
    page.edit = edit;
    page.onMediatorTrace = function (evt: object) {
        return onLog('mediator', evt);
    };
    page.onCapabilityTrace = function (evt: object) {
        return onLog('capability', evt);
    };
    demoEl.appendChild(page);
    onLog('page-mount', { pageId, edit });
    return function () {
        try {
            page.remove();
        }
        catch { /* already detached */ }
    };
}
