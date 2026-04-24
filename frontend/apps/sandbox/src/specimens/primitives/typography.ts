import { S } from '../_register.ts';

S({
  id: 'heading',
  name: 'Heading',
  tag: 'atlas-heading',
  variants: [
    {
      name: 'All levels',
      html: `
        <atlas-stack gap="sm">
          <atlas-heading level="1">Heading level 1</atlas-heading>
          <atlas-heading level="2">Heading level 2</atlas-heading>
          <atlas-heading level="3">Heading level 3</atlas-heading>
          <atlas-heading level="4">Heading level 4</atlas-heading>
          <atlas-heading level="5">Heading level 5</atlas-heading>
          <atlas-heading level="6">Heading level 6</atlas-heading>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'text',
  name: 'Text',
  tag: 'atlas-text',
  variants: [
    {
      name: 'Variants',
      html: `
        <atlas-stack gap="sm">
          <atlas-text block>Default body text</atlas-text>
          <atlas-text block variant="medium">Medium weight text</atlas-text>
          <atlas-text block variant="muted">Muted secondary text</atlas-text>
          <atlas-text block variant="small">Small helper text</atlas-text>
          <atlas-text block variant="error">Error message text</atlas-text>
          <atlas-text block variant="mono">Monospace code text</atlas-text>
        </atlas-stack>
      `,
    },
    {
      name: 'Inline usage',
      html: `
        <atlas-text>This is <atlas-text variant="medium">medium</atlas-text> and <atlas-text variant="muted">muted</atlas-text> inline.</atlas-text>
      `,
    },
  ],
});
