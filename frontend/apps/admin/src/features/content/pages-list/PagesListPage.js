import { AtlasSurface, html } from '@atlas/core';
import { backend } from '@atlas/api-client';
import '@atlas/design';
import '@atlas/widgets';

const COLUMNS = (host) => [
  { key: 'title', label: 'Title', sortable: true, filter: { type: 'text' } },
  {
    key: 'slug',
    label: 'Slug',
    sortable: true,
    format: (value) => `/${value ?? ''}`,
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
    format: (value, row) => {
      const btn = document.createElement('atlas-button');
      btn.setAttribute('name', 'row-delete');
      btn.setAttribute('variant', 'danger');
      btn.setAttribute('size', 'sm');
      btn.textContent = 'Delete';
      btn.addEventListener('click', () => host._deletePage(row.pageId));
      return btn;
    },
  },
];

class PagesListPage extends AtlasSurface {
  static surfaceId = 'admin.content.pages-list';
  static loading = { rows: 5 };
  static empty = {
    heading: 'No pages yet',
    body: 'Create your first page to get started.',
    action: 'Create page',
  };

  _unsubscribe = null;

  async load() {
    return await backend.query('/pages');
  }

  render() {
    const pages = this.data ?? [];
    return html`
      <atlas-stack gap="lg">
        <atlas-stack direction="row" justify="space-between" align="center">
          <atlas-heading level="1">Content Pages</atlas-heading>
          <atlas-button name="create-button" variant="primary" @click=${() => this._createPage()}>
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
   * `.prop=${…}` bindings, but the column format closures are easier
   * to reason about imperatively.
   */
  _renderTable(pages) {
    const table = document.createElement('atlas-data-table');
    table.setAttribute('name', 'table');
    table.setAttribute('label', 'Content pages');
    table.setAttribute('row-key', 'pageId');
    table.setAttribute('page-size', '25');
    table.columns = COLUMNS(this);
    table.data = pages;
    return table;
  }

  onMount() {
    this.emit('admin.content.pages-list.page-viewed');

    this._unsubscribe = backend.subscribe('projection.updated', (event) => {
      if (event.resourceType === 'page') {
        this.reload();
      }
    });

    this.addEventListener('empty-action', () => this._createPage());
  }

  onUnmount() {
    if (this._unsubscribe) {
      this._unsubscribe();
    }
  }

  async _createPage() {
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

  async _deletePage(pageId) {
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
