import { AtlasSurface, html } from '@atlas/core';
import { backend } from '@atlas/api-client';
import '@atlas/design';
import '@atlas/widgets';

interface PageRow {
  pageId: string;
  title: string;
  slug: string;
  status?: string;
  updatedAt?: string;
}

interface ColumnFilterSpec {
  type: 'text' | 'select';
}

interface ColumnSpec {
  key: keyof PageRow | string;
  label: string;
  sortable?: boolean;
  filter?: ColumnFilterSpec;
  format?: string | ((value: unknown, row: PageRow) => string | Node);
}

interface DataTableElement extends HTMLElement {
  columns: readonly ColumnSpec[];
  data: readonly PageRow[];
}

interface ProjectionUpdatedEvent {
  resourceType?: string;
}

const COLUMNS = (host: PagesListPage): readonly ColumnSpec[] => [
  { key: 'title', label: 'Title', sortable: true, filter: { type: 'text' } },
  {
    key: 'slug',
    label: 'Slug',
    sortable: true,
    format: (value: unknown): string => `/${(value as string | undefined) ?? ''}`,
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
    format: (_value: unknown, row: PageRow): Node => {
      const btn = document.createElement('atlas-button');
      btn.setAttribute('name', 'row-delete');
      btn.setAttribute('variant', 'danger');
      btn.setAttribute('size', 'sm');
      btn.textContent = 'Delete';
      btn.addEventListener('click', () => {
        void host._deletePage(row.pageId);
      });
      return btn;
    },
  },
];

class PagesListPage extends AtlasSurface {
  static override surfaceId = 'admin.content.pages-list';
  static override loading = { rows: 5 };
  static override empty = {
    heading: 'No pages yet',
    body: 'Create your first page to get started.',
    action: 'Create page',
  };

  private _unsubscribe: (() => void) | null = null;

  override async load(): Promise<readonly PageRow[]> {
    const result = await backend.query('/pages');
    return (result as readonly PageRow[] | null) ?? [];
  }

  override render(): DocumentFragment {
    const pages = (this.data as readonly PageRow[] | null) ?? [];
    return html`
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
    const table = document.createElement('atlas-data-table') as DataTableElement;
    table.setAttribute('name', 'table');
    table.setAttribute('label', 'Content pages');
    table.setAttribute('row-key', 'pageId');
    table.setAttribute('page-size', '25');
    table.columns = COLUMNS(this);
    table.data = pages;
    return table;
  }

  override onMount(): void {
    this.emit('admin.content.pages-list.page-viewed');

    this._unsubscribe = backend.subscribe('projection.updated', (event: unknown) => {
      const ev = event as ProjectionUpdatedEvent | null;
      if (ev && ev.resourceType === 'page') {
        void this.reload();
      }
    });

    this.addEventListener('empty-action', () => {
      void this._createPage();
    });
  }

  override onUnmount(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  async _createPage(): Promise<void> {
    this.emit('admin.content.pages-list.create-clicked');
    const title = prompt('Page title:');
    if (!title) return;

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
    if (!confirm('Delete this page?')) return;

    await backend.mutate('/intents', {
      actionId: 'ContentPages.Page.Delete',
      resourceType: 'Page',
      pageId,
    });
    await this.reload();
  }
}

AtlasSurface.define('pages-list-page', PagesListPage);
