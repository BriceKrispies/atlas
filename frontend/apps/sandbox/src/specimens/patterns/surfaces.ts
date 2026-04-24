import { S } from '../_register.ts';

S({
  id: 'surface-pages-list',
  name: 'Pages List Surface',
  tag: 'pages-list-page',
  states: {
    loading: `<atlas-skeleton rows="5"></atlas-skeleton>`,
    error: `
      <atlas-box padding="lg">
        <atlas-stack gap="sm">
          <atlas-text variant="error">Failed to load pages: Connection refused</atlas-text>
          <atlas-box><atlas-button>Retry</atlas-button></atlas-box>
        </atlas-stack>
      </atlas-box>
    `,
    empty: `
      <atlas-stack gap="md" align="center" padding="xl">
        <atlas-heading level="2">No pages yet</atlas-heading>
        <atlas-text variant="muted" block>Create your first page to get started.</atlas-text>
        <atlas-button variant="primary">Create page</atlas-button>
      </atlas-stack>
    `,
    success: `
      <atlas-stack gap="lg">
        <atlas-stack direction="row" justify="space-between" align="center">
          <atlas-heading level="1">Content Pages</atlas-heading>
          <atlas-button variant="primary">Create page</atlas-button>
        </atlas-stack>
        <atlas-table label="Content pages">
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
            <atlas-row>
              <atlas-table-cell><atlas-text variant="medium">Welcome Page</atlas-text></atlas-table-cell>
              <atlas-table-cell><atlas-text variant="muted">/welcome</atlas-text></atlas-table-cell>
              <atlas-table-cell><atlas-badge status="published">published</atlas-badge></atlas-table-cell>
              <atlas-table-cell><atlas-text variant="muted">Apr 10, 2026</atlas-text></atlas-table-cell>
              <atlas-table-cell><atlas-button variant="danger" size="sm">Delete</atlas-button></atlas-table-cell>
            </atlas-row>
            <atlas-row>
              <atlas-table-cell><atlas-text variant="medium">About Us</atlas-text></atlas-table-cell>
              <atlas-table-cell><atlas-text variant="muted">/about-us</atlas-text></atlas-table-cell>
              <atlas-table-cell><atlas-badge status="draft">draft</atlas-badge></atlas-table-cell>
              <atlas-table-cell><atlas-text variant="muted">Apr 8, 2026</atlas-text></atlas-table-cell>
              <atlas-table-cell><atlas-button variant="danger" size="sm">Delete</atlas-button></atlas-table-cell>
            </atlas-row>
          </atlas-table-body>
        </atlas-table>
      </atlas-stack>
    `,
  },
});

S({
  id: 'surface-detail',
  name: 'Detail Surface',
  tag: 'atlas-box',
  states: {
    loading: `<atlas-skeleton rows="3"></atlas-skeleton>`,
    error: `
      <atlas-box padding="lg">
        <atlas-stack gap="sm">
          <atlas-text variant="error">Unable to load badge details: 404 Not Found</atlas-text>
          <atlas-box><atlas-button>Retry</atlas-button></atlas-box>
        </atlas-stack>
      </atlas-box>
    `,
    empty: `
      <atlas-stack gap="md" align="center" padding="xl">
        <atlas-heading level="2">Badge not found</atlas-heading>
        <atlas-text variant="muted" block>This badge may have been deleted.</atlas-text>
      </atlas-stack>
    `,
    success: `
      <atlas-stack gap="lg">
        <atlas-stack gap="xs">
          <atlas-heading level="1">Gold Star</atlas-heading>
          <atlas-text variant="muted">Awarded for outstanding contributions</atlas-text>
        </atlas-stack>
        <atlas-stack direction="row" gap="lg">
          <atlas-stack gap="xs">
            <atlas-text variant="small">Status</atlas-text>
            <atlas-badge status="published">active</atlas-badge>
          </atlas-stack>
          <atlas-stack gap="xs">
            <atlas-text variant="small">Awarded</atlas-text>
            <atlas-text variant="medium">142 times</atlas-text>
          </atlas-stack>
          <atlas-stack gap="xs">
            <atlas-text variant="small">Created</atlas-text>
            <atlas-text variant="muted">Jan 15, 2026</atlas-text>
          </atlas-stack>
        </atlas-stack>
        <atlas-stack direction="row" gap="sm" justify="end">
          <atlas-button variant="ghost">Archive</atlas-button>
          <atlas-button variant="primary">Edit badge</atlas-button>
        </atlas-stack>
      </atlas-stack>
    `,
  },
});
