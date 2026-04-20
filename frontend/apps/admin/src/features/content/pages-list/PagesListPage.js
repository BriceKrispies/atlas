import { AtlasSurface, html } from '@atlas/core';
import { backend } from '@atlas/api-client';
import '@atlas/design';

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
    const pages = this.data;
    return html`
      <atlas-stack gap="lg">
        <atlas-stack direction="row" justify="space-between" align="center">
          <atlas-heading level="1">Content Pages</atlas-heading>
          <atlas-button name="create-button" variant="primary" @click=${() => this._createPage()}>
            Create page
          </atlas-button>
        </atlas-stack>
        <atlas-table name="table" label="Content pages">
          <atlas-table-head>
            <atlas-row>
              <atlas-table-cell header>Title</atlas-table-cell>
              <atlas-table-cell header>Slug</atlas-table-cell>
              <atlas-table-cell header>Status</atlas-table-cell>
              <atlas-table-cell header>Updated</atlas-table-cell>
              <atlas-table-cell header>Actions</atlas-table-cell>
            </atlas-row>
          </atlas-table-head>
          <atlas-table-body>
            ${pages.map(
              (page) => html`
                <atlas-row name="row" key="${page.pageId}">
                  <atlas-table-cell><atlas-text variant="medium">${page.title}</atlas-text></atlas-table-cell>
                  <atlas-table-cell><atlas-text variant="muted">/${page.slug}</atlas-text></atlas-table-cell>
                  <atlas-table-cell><atlas-badge status="${page.status}">${page.status}</atlas-badge></atlas-table-cell>
                  <atlas-table-cell><atlas-text variant="muted">${formatDate(page.updatedAt)}</atlas-text></atlas-table-cell>
                  <atlas-table-cell>
                    <atlas-button name="row-delete" variant="danger" size="sm" @click=${() => this._deletePage(page.pageId)}>
                      Delete
                    </atlas-button>
                  </atlas-table-cell>
                </atlas-row>
              `
            )}
          </atlas-table-body>
        </atlas-table>
      </atlas-stack>
    `;
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

/** @param {string} iso */
function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
