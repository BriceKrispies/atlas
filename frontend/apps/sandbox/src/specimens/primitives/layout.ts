import { S } from '../_register.ts';

S({
  id: 'box',
  name: 'Box',
  tag: 'atlas-box',
  variants: [
    {
      name: 'Default',
      html: `<atlas-box style="border:1px dashed var(--atlas-color-border)">Content inside a box</atlas-box>`,
    },
    {
      name: 'Padding variants',
      html: `
        <atlas-stack gap="sm">
          <atlas-box padding="xs" style="border:1px dashed var(--atlas-color-border)"><atlas-text variant="small">padding="xs"</atlas-text></atlas-box>
          <atlas-box padding="sm" style="border:1px dashed var(--atlas-color-border)"><atlas-text variant="small">padding="sm"</atlas-text></atlas-box>
          <atlas-box padding="md" style="border:1px dashed var(--atlas-color-border)"><atlas-text variant="small">padding="md"</atlas-text></atlas-box>
          <atlas-box padding="lg" style="border:1px dashed var(--atlas-color-border)"><atlas-text variant="small">padding="lg"</atlas-text></atlas-box>
          <atlas-box padding="xl" style="border:1px dashed var(--atlas-color-border)"><atlas-text variant="small">padding="xl"</atlas-text></atlas-box>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'stack',
  name: 'Stack',
  tag: 'atlas-stack',
  variants: [
    {
      name: 'Column (default)',
      html: `
        <atlas-stack gap="sm">
          <atlas-box padding="sm" style="background:var(--atlas-color-surface);border:1px solid var(--atlas-color-border)"><atlas-text>Item 1</atlas-text></atlas-box>
          <atlas-box padding="sm" style="background:var(--atlas-color-surface);border:1px solid var(--atlas-color-border)"><atlas-text>Item 2</atlas-text></atlas-box>
          <atlas-box padding="sm" style="background:var(--atlas-color-surface);border:1px solid var(--atlas-color-border)"><atlas-text>Item 3</atlas-text></atlas-box>
        </atlas-stack>
      `,
    },
    {
      name: 'Row with space-between',
      html: `
        <atlas-stack direction="row" justify="space-between" align="center">
          <atlas-text variant="medium">Left</atlas-text>
          <atlas-text variant="muted">Right</atlas-text>
        </atlas-stack>
      `,
    },
    {
      name: 'Row with gap variants',
      html: `
        <atlas-stack gap="lg">
          <atlas-stack direction="row" gap="xs">
            <atlas-box padding="sm" style="background:var(--atlas-color-primary-subtle)"><atlas-text variant="small">xs</atlas-text></atlas-box>
            <atlas-box padding="sm" style="background:var(--atlas-color-primary-subtle)"><atlas-text variant="small">xs</atlas-text></atlas-box>
            <atlas-box padding="sm" style="background:var(--atlas-color-primary-subtle)"><atlas-text variant="small">xs</atlas-text></atlas-box>
          </atlas-stack>
          <atlas-stack direction="row" gap="md">
            <atlas-box padding="sm" style="background:var(--atlas-color-primary-subtle)"><atlas-text variant="small">md</atlas-text></atlas-box>
            <atlas-box padding="sm" style="background:var(--atlas-color-primary-subtle)"><atlas-text variant="small">md</atlas-text></atlas-box>
            <atlas-box padding="sm" style="background:var(--atlas-color-primary-subtle)"><atlas-text variant="small">md</atlas-text></atlas-box>
          </atlas-stack>
          <atlas-stack direction="row" gap="xl">
            <atlas-box padding="sm" style="background:var(--atlas-color-primary-subtle)"><atlas-text variant="small">xl</atlas-text></atlas-box>
            <atlas-box padding="sm" style="background:var(--atlas-color-primary-subtle)"><atlas-text variant="small">xl</atlas-text></atlas-box>
            <atlas-box padding="sm" style="background:var(--atlas-color-primary-subtle)"><atlas-text variant="small">xl</atlas-text></atlas-box>
          </atlas-stack>
        </atlas-stack>
      `,
    },
  ],
});
