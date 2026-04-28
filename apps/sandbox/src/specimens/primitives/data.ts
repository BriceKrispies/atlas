import { S } from '../_register.ts';

S({
  id: 'table',
  name: 'Table',
  tag: 'atlas-table',
  states: {
    loading: `<atlas-skeleton rows="5"></atlas-skeleton>`,
    error: `
      <atlas-box padding="lg">
        <atlas-stack gap="sm">
          <atlas-text variant="error">Failed to load data: Network error</atlas-text>
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
      <atlas-table label="Example data">
        <atlas-table-head>
          <atlas-row>
            <atlas-table-cell header>Name</atlas-table-cell>
            <atlas-table-cell header>Status</atlas-table-cell>
            <atlas-table-cell header>Updated</atlas-table-cell>
            <atlas-table-cell header>Actions</atlas-table-cell>
          </atlas-row>
        </atlas-table-head>
        <atlas-table-body>
          <atlas-row>
            <atlas-table-cell><atlas-text variant="medium">Welcome Page</atlas-text></atlas-table-cell>
            <atlas-table-cell><atlas-badge status="published">published</atlas-badge></atlas-table-cell>
            <atlas-table-cell><atlas-text variant="muted">Apr 10, 2026</atlas-text></atlas-table-cell>
            <atlas-table-cell><atlas-button variant="danger" size="sm">Delete</atlas-button></atlas-table-cell>
          </atlas-row>
          <atlas-row>
            <atlas-table-cell><atlas-text variant="medium">About Us</atlas-text></atlas-table-cell>
            <atlas-table-cell><atlas-badge status="draft">draft</atlas-badge></atlas-table-cell>
            <atlas-table-cell><atlas-text variant="muted">Apr 8, 2026</atlas-text></atlas-table-cell>
            <atlas-table-cell><atlas-button variant="danger" size="sm">Delete</atlas-button></atlas-table-cell>
          </atlas-row>
          <atlas-row>
            <atlas-table-cell><atlas-text variant="medium">FAQ</atlas-text></atlas-table-cell>
            <atlas-table-cell><atlas-badge status="archived">archived</atlas-badge></atlas-table-cell>
            <atlas-table-cell><atlas-text variant="muted">Mar 15, 2026</atlas-text></atlas-table-cell>
            <atlas-table-cell><atlas-button variant="danger" size="sm">Delete</atlas-button></atlas-table-cell>
          </atlas-row>
        </atlas-table-body>
      </atlas-table>
    `,
  },
  variants: [
    {
      name: 'Header only',
      html: `
        <atlas-table label="Empty table">
          <atlas-table-head>
            <atlas-row>
              <atlas-table-cell header>Name</atlas-table-cell>
              <atlas-table-cell header>Status</atlas-table-cell>
              <atlas-table-cell header>Updated</atlas-table-cell>
            </atlas-row>
          </atlas-table-head>
        </atlas-table>
      `,
    },
  ],
});
