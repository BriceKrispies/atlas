import { S } from '../_register.ts';

S({
  id: 'form-group',
  name: 'Form Group',
  tag: 'atlas-stack',
  variants: [
    {
      name: 'Simple form',
      html: `
        <atlas-stack gap="lg" style="max-width:400px">
          <atlas-heading level="2">Create Page</atlas-heading>
          <atlas-input label="Title" placeholder="Enter page title" required></atlas-input>
          <atlas-input label="Slug" placeholder="e.g. welcome"></atlas-input>
          <atlas-stack direction="row" gap="sm" justify="end">
            <atlas-button variant="ghost">Cancel</atlas-button>
            <atlas-button variant="primary">Create</atlas-button>
          </atlas-stack>
        </atlas-stack>
      `,
    },
  ],
});
