import { S } from '../_register.ts';

S({
  id: 'page-header',
  name: 'Page Header',
  tag: 'atlas-stack',
  variants: [
    {
      name: 'Title + action button',
      html: `
        <atlas-stack direction="row" justify="space-between" align="center">
          <atlas-heading level="1">Content Pages</atlas-heading>
          <atlas-button variant="primary">Create page</atlas-button>
        </atlas-stack>
      `,
    },
    {
      name: 'Title + subtitle',
      html: `
        <atlas-stack gap="xs">
          <atlas-heading level="1">Badge Configuration</atlas-heading>
          <atlas-text variant="muted">Manage badges awarded to users across your tenant.</atlas-text>
        </atlas-stack>
      `,
    },
  ],
});
