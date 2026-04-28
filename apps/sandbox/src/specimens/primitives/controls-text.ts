import { S } from '../_register.ts';

S({
  id: 'button',
  name: 'Button',
  tag: 'atlas-button',
  variants: [
    {
      name: 'Variants',
      html: `
        <atlas-stack direction="row" gap="sm" align="center">
          <atlas-button>Default</atlas-button>
          <atlas-button variant="primary">Primary</atlas-button>
          <atlas-button variant="danger">Danger</atlas-button>
          <atlas-button variant="ghost">Ghost</atlas-button>
        </atlas-stack>
      `,
    },
    {
      name: 'Sizes',
      html: `
        <atlas-stack direction="row" gap="sm" align="center">
          <atlas-button size="sm">Small</atlas-button>
          <atlas-button>Default</atlas-button>
        </atlas-stack>
      `,
    },
    {
      name: 'In context',
      html: `
        <atlas-stack direction="row" gap="sm" justify="end">
          <atlas-button variant="ghost">Cancel</atlas-button>
          <atlas-button variant="primary">Save changes</atlas-button>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'input',
  name: 'Input',
  tag: 'atlas-input',
  variants: [
    {
      name: 'With label',
      html: `
        <atlas-stack gap="md" style="max-width:360px">
          <atlas-input label="Page title" placeholder="Enter a title"></atlas-input>
          <atlas-input label="Slug" placeholder="e.g. welcome-page"></atlas-input>
          <atlas-input label="Email" type="email" placeholder="user@example.com" required></atlas-input>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'textarea',
  name: 'Textarea',
  tag: 'atlas-textarea',
  variants: [
    {
      name: 'Default',
      html: `<atlas-textarea label="Comment" placeholder="Share your thoughts…" rows="3"></atlas-textarea>`,
    },
    {
      name: 'With max length counter',
      html: `<atlas-textarea label="Bio" placeholder="Tell us about you" maxlength="140" rows="3"></atlas-textarea>`,
    },
    {
      name: 'Autoresize + pre-filled',
      html: `
        <atlas-textarea label="Notes" autoresize rows="2">Autoresize grows the textarea as the user types.
Try adding more lines here — it should expand without a manual resize handle.</atlas-textarea>
      `,
    },
    {
      name: 'Disabled & readonly',
      html: `
        <atlas-stack gap="sm">
          <atlas-textarea label="Disabled" disabled rows="2">Can't touch this.</atlas-textarea>
          <atlas-textarea label="Readonly" readonly rows="2">Readonly — selection allowed, editing not.</atlas-textarea>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'number-input',
  name: 'NumberInput',
  tag: 'atlas-number-input',
  variants: [
    {
      name: 'Default',
      html: `<atlas-number-input label="Quantity" value="1" min="0" max="99"></atlas-number-input>`,
    },
    {
      name: 'Decimal step',
      html: `<atlas-number-input label="Price" value="19.99" min="0" step="0.01"></atlas-number-input>`,
    },
    {
      name: 'Clamped to range',
      html: `<atlas-number-input label="Rating (1-5)" value="5" min="1" max="5"></atlas-number-input>`,
    },
    {
      name: 'Disabled',
      html: `<atlas-number-input label="Locked" value="42" disabled></atlas-number-input>`,
    },
  ],
});

S({
  id: 'search-input',
  name: 'SearchInput',
  tag: 'atlas-search-input',
  variants: [
    {
      name: 'Default',
      html: `<atlas-search-input placeholder="Search pages…"></atlas-search-input>`,
    },
    {
      name: 'With label and value',
      html: `<atlas-search-input label="Find user" value="alice" placeholder="Name or email"></atlas-search-input>`,
    },
    {
      name: 'Disabled',
      html: `<atlas-search-input placeholder="Indexing…" disabled></atlas-search-input>`,
    },
  ],
});
