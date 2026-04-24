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
