import { AtlasSurface, html } from '@atlas/core';
import { backend } from '@atlas/api-client';
import { registerTestState } from '@atlas/test-state';
import '@atlas/design';
import '@atlas/widgets';
import type { Columns } from '@atlas/widgets';
interface PageRow {
    pageId: string;
    title: string;
    slug: string;
    status?: string;
    updatedAt?: string;
    [k: string]: unknown;
}
/**
 * Set a property on a custom element. `<atlas-data-table>` declares
 * `columns` / `data` setters that normalise internally, but the DOM
 * `HTMLElement` type doesn't expose them — we forward via `Reflect.set`
 * so no narrowing cast is required at the assignment site. Mirrors the
 * `html` template binding in `packages/core/src/html.ts`.
 */
function setProp(el: HTMLElement, key: string, value: unknown): void {
    Reflect.set(el, key, value);
}
const COLUMNS = function (host: PagesListPage): Columns<PageRow> {
    return [
        { key: 'title', label: 'Title', sortable: true, filter: { type: 'text' } },
        {
            key: 'slug',
            label: 'Slug',
            sortable: true,
            // value is inferred as string — no cast required.
            format: function (value): string {
                return `/${value ?? ''}`;
            },
        },
        {
            key: 'status',
            label: 'Status',
            sortable: true,
            format: 'status',
            filter: { type: 'select' },
        },
        {
            key: 'updatedAt',
            label: 'Updated',
            sortable: true,
            format: 'date',
        },
        {
            key: 'pageId',
            label: 'Actions',
            format: function (_value, row): Node {
                const btn = document.createElement('atlas-button');
                btn.setAttribute('name', 'row-delete');
                btn.setAttribute('variant', 'danger');
                btn.setAttribute('size', 'sm');
                btn.textContent = 'Delete';
                btn.addEventListener('click', function () {
                    void host._deletePage(row.pageId);
                });
                return btn;
            },
        },
    ];
};
class PagesListPage extends AtlasSurface {
    static override surfaceId = 'admin.content.pages-list';
    static override loading = { rows: 5 };
    static override empty = {
        heading: 'No pages yet',
        body: 'Create your first page to get started.',
        action: 'Create page',
    };
    /**
     * Narrow the inherited `data: unknown` to the load() return shape so
     * render() and the test-state reader read it without an `as` cast.
     */
    declare data: readonly PageRow[] | null;
    override async load(): Promise<readonly PageRow[]> {
        const result = await backend.query('/pages');
        // `backend.query` is typed `Promise<unknown>` at the boundary; trust
        // the array shape from the `/pages` route and drop non-arrays to `[]`.
        return Array.isArray(result) ? (result as readonly PageRow[]) : [];
    }
    /**
     * Tag-based subscription replaces the prior
     * `backend.subscribe('projection.updated', …)` wiring (see
     * `specs/worker.md` phase 5). Phase 5 server-side filtering is
     * strict-equality only — no wildcards — so we subscribe to the
     * coarse tenant tag rather than `Page:*`. The cost is one refetch
     * on any tenant-level invalidation, which matches the previous
     * behaviour (the old code reloaded on every `projection.updated`
     * with `resourceType === 'page'`, regardless of which page).
     */
    override subscribesTo(): string[] {
        const tenantId = (import.meta.env.VITE_TENANT_ID ?? 'tenant-001') as string;
        return [`Tenant:${tenantId}`];
    }
    override render(): DocumentFragment {
        const pages = (this.data as readonly PageRow[] | null) ?? [];
        return html `
      <atlas-stack gap="lg">
        <atlas-stack direction="row" justify="space-between" align="center">
          <atlas-heading level="1">Content Pages</atlas-heading>
          <atlas-button name="create-button" variant="primary" @click=${(): void => {
            void this._createPage();
        }}>
            Create page
          </atlas-button>
        </atlas-stack>
        ${this._renderTable(pages)}
      </atlas-stack>
    `;
    }
    /**
     * Build the <atlas-data-table> programmatically so we can assign
     * property-only values (columns, data) — the `html` template supports
     * `.prop=${...}` bindings, but the column format closures are easier
     * to reason about imperatively.
     */
    private _renderTable(pages: readonly PageRow[]): HTMLElement {
        const table = document.createElement('atlas-data-table');
        table.setAttribute('name', 'table');
        table.setAttribute('label', 'Content pages');
        table.setAttribute('row-key', 'pageId');
        table.setAttribute('page-size', '25');
        setProp(table, 'columns', COLUMNS(this));
        setProp(table, 'data', pages);
        return table;
    }
    private _disposeTestState: (() => void) | null = null;
    override onMount(): void {
        this.emit('admin.content.pages-list.page-viewed');
        // Expose surface state to Playwright via `window.__atlasTest`.
        this._disposeTestState = registerTestState(this.surfaceId, () => ({
            state: this.getAttribute('data-state') ?? 'unknown',
            rowCount: (this.data as readonly PageRow[] | null)?.length ?? 0,
        }));
        // SSE refetch is now wired via `subscribesTo()` + the bound
        // backend adapter (see AtlasSurface in @atlas/core). No manual
        // subscribe/unsubscribe here — AtlasSurface owns the lifecycle.
        this.addEventListener('empty-action', () => {
            void this._createPage();
        });
    }
    override onUnmount(): void {
        if (this._disposeTestState) {
            this._disposeTestState();
            this._disposeTestState = null;
        }
    }
    async _createPage(): Promise<void> {
        this.emit('admin.content.pages-list.create-clicked');
        const title = prompt('Page title:');
        if (!title)
            return;
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        await backend.mutate('/intents', {
            actionId: 'ContentPages.Page.Create',
            resourceType: 'Page',
            pageId: `pg_${Date.now()}`,
            title,
            slug,
        });
        await this.reload();
    }
    async _deletePage(pageId: string): Promise<void> {
        this.emit('admin.content.pages-list.row-delete-clicked', { pageId });
        if (!confirm('Delete this page?'))
            return;
        await backend.mutate('/intents', {
            actionId: 'ContentPages.Page.Delete',
            resourceType: 'Page',
            pageId,
        });
        await this.reload();
    }
}
AtlasSurface.define('pages-list-page', PagesListPage);
