import { S } from '../_register.ts';

S({
  id: 'shell-header',
  name: 'Shell Header',
  tag: 'atlas-box',
  variants: [
    {
      name: 'Dark header bar',
      html: `
        <atlas-box style="display:flex;align-items:center;padding:0 var(--atlas-space-lg);height:48px;background:var(--atlas-color-shell-bg)">
          <atlas-heading level="3" style="color:var(--atlas-color-shell-text);letter-spacing:0.04em">Atlas</atlas-heading>
        </atlas-box>
      `,
    },
  ],
});
