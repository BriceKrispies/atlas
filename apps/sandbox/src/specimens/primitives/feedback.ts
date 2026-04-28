import { S } from '../_register.ts';

S({
  id: 'badge',
  name: 'Badge',
  tag: 'atlas-badge',
  variants: [
    {
      name: 'Status variants',
      html: `
        <atlas-stack direction="row" gap="sm" align="center">
          <atlas-badge status="published">published</atlas-badge>
          <atlas-badge status="draft">draft</atlas-badge>
          <atlas-badge status="archived">archived</atlas-badge>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'skeleton',
  name: 'Skeleton',
  tag: 'atlas-skeleton',
  variants: [
    {
      name: 'Default (5 rows)',
      html: `<atlas-skeleton rows="5"></atlas-skeleton>`,
    },
    {
      name: '3 rows',
      html: `<atlas-skeleton rows="3"></atlas-skeleton>`,
    },
  ],
});

S({
  id: 'alert',
  name: 'Alert',
  tag: 'atlas-alert',
  variants: [
    {
      name: 'Tones',
      html: `
        <atlas-stack gap="sm">
          <atlas-alert tone="info" heading="Heads up">
            Saved drafts are cleared after 30 days. Publish to keep them permanently.
          </atlas-alert>
          <atlas-alert tone="success" heading="Published">
            <atlas-text>Your changes are live at <atlas-link href="#">acme.example.com</atlas-link>.</atlas-text>
          </atlas-alert>
          <atlas-alert tone="warning" heading="Low quota">
            You are at 87% of your monthly events limit.
          </atlas-alert>
          <atlas-alert tone="danger" heading="Payment failed">
            Update your card to keep the service running.
          </atlas-alert>
        </atlas-stack>
      `,
    },
    {
      name: 'Body-only, dismissible, with actions',
      html: `
        <atlas-stack gap="sm">
          <atlas-alert>Minimal — no heading, no tone.</atlas-alert>
          <atlas-alert tone="info" dismissible>Dismissible info banner.</atlas-alert>
          <atlas-alert tone="warning" heading="Unsaved changes">
            You have unsaved edits. Leaving will discard them.
            <atlas-stack slot="actions" direction="row" gap="sm">
              <atlas-button size="sm" variant="secondary">Discard</atlas-button>
              <atlas-button size="sm">Save</atlas-button>
            </atlas-stack>
          </atlas-alert>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'empty-state',
  name: 'EmptyState',
  tag: 'atlas-empty-state',
  variants: [
    {
      name: 'Heading + description (attrs)',
      html: `
        <atlas-empty-state
          heading="No pages yet"
          description="Create your first page to start building content. Pages are grouped into modules and rendered through the content pipeline."
        >
          <atlas-icon name="menu" size="lg"></atlas-icon>
          <atlas-stack slot="actions" direction="row" gap="sm">
            <atlas-button variant="secondary" size="sm">Import</atlas-button>
            <atlas-button size="sm">New page</atlas-button>
          </atlas-stack>
        </atlas-empty-state>
      `,
    },
    {
      name: 'Slot content + subtle tone',
      html: `
        <atlas-empty-state tone="subtle">
          <atlas-icon name="search"></atlas-icon>
          <atlas-heading level="4" slot="heading">No results</atlas-heading>
          <atlas-text slot="description" variant="muted">
            Try removing a filter or searching a broader term.
          </atlas-text>
        </atlas-empty-state>
      `,
    },
  ],
});

S({
  id: 'spinner',
  name: 'Spinner',
  tag: 'atlas-spinner',
  variants: [
    {
      name: 'Sizes',
      html: `
        <atlas-stack direction="row" gap="lg" align="center">
          <atlas-spinner size="sm"></atlas-spinner>
          <atlas-spinner size="md"></atlas-spinner>
          <atlas-spinner size="lg"></atlas-spinner>
          <atlas-text variant="muted">sm · md · lg</atlas-text>
        </atlas-stack>
      `,
    },
    {
      name: 'Inline (1em)',
      html: `
        <atlas-text>Loading feed <atlas-spinner size="1em"></atlas-spinner> one moment…</atlas-text>
      `,
    },
    {
      name: 'Colour inheritance',
      html: `
        <atlas-stack gap="sm">
          <atlas-box style="color: var(--atlas-color-primary)"><atlas-spinner label="Loading"></atlas-spinner></atlas-box>
          <atlas-box style="color: var(--atlas-color-warning-text)"><atlas-spinner></atlas-spinner></atlas-box>
          <atlas-box style="color: var(--atlas-color-danger)"><atlas-spinner></atlas-spinner></atlas-box>
        </atlas-stack>
      `,
    },
  ],
});
