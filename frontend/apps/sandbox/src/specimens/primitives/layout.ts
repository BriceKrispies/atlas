import { S } from '../_register.ts';

S({
  id: 'card',
  name: 'Card',
  tag: 'atlas-card',
  variants: [
    {
      name: 'Default, variants, padding',
      html: `
        <atlas-stack gap="md">
          <atlas-card>
            <atlas-text>Default outlined card</atlas-text>
          </atlas-card>
          <atlas-card variant="elevated">
            <atlas-text>Elevated card (hover to lift)</atlas-text>
          </atlas-card>
          <atlas-card variant="filled">
            <atlas-text>Filled card (on surface)</atlas-text>
          </atlas-card>
        </atlas-stack>
      `,
    },
    {
      name: 'Padding + interactive + selected',
      html: `
        <atlas-stack gap="md">
          <atlas-card padding="sm"><atlas-text variant="small">padding="sm"</atlas-text></atlas-card>
          <atlas-card padding="md"><atlas-text variant="small">padding="md" (default)</atlas-text></atlas-card>
          <atlas-card padding="lg"><atlas-text variant="small">padding="lg"</atlas-text></atlas-card>
          <atlas-card interactive tabindex="0">
            <atlas-text>Interactive — hover + focus affordance</atlas-text>
          </atlas-card>
          <atlas-card selected>
            <atlas-text>Selected — primary ring</atlas-text>
          </atlas-card>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'divider',
  name: 'Divider',
  tag: 'atlas-divider',
  variants: [
    {
      name: 'Horizontal — default / strong / subtle',
      html: `
        <atlas-stack gap="md">
          <atlas-text variant="small">Default</atlas-text>
          <atlas-divider></atlas-divider>
          <atlas-text variant="small">Strong</atlas-text>
          <atlas-divider tone="strong"></atlas-divider>
          <atlas-text variant="small">With spacing="md"</atlas-text>
          <atlas-divider spacing="md"></atlas-divider>
          <atlas-text variant="small">After the divider</atlas-text>
        </atlas-stack>
      `,
    },
    {
      name: 'Vertical inline',
      html: `
        <atlas-stack direction="row" align="center" gap="sm" style="height: 24px">
          <atlas-text>Left</atlas-text>
          <atlas-divider orientation="vertical"></atlas-divider>
          <atlas-text>Middle</atlas-text>
          <atlas-divider orientation="vertical"></atlas-divider>
          <atlas-text>Right</atlas-text>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'grid',
  name: 'Grid',
  tag: 'atlas-grid',
  variants: [
    {
      name: 'Auto-fit (default) with min-col',
      html: `
        <atlas-grid>
          <atlas-card padding="sm"><atlas-text variant="small">A</atlas-text></atlas-card>
          <atlas-card padding="sm"><atlas-text variant="small">B</atlas-text></atlas-card>
          <atlas-card padding="sm"><atlas-text variant="small">C</atlas-text></atlas-card>
          <atlas-card padding="sm"><atlas-text variant="small">D</atlas-text></atlas-card>
          <atlas-card padding="sm"><atlas-text variant="small">E</atlas-text></atlas-card>
        </atlas-grid>
      `,
    },
    {
      name: 'Explicit columns + gap',
      html: `
        <atlas-stack gap="md">
          <atlas-grid columns="3" gap="sm">
            <atlas-card padding="sm"><atlas-text variant="small">1</atlas-text></atlas-card>
            <atlas-card padding="sm"><atlas-text variant="small">2</atlas-text></atlas-card>
            <atlas-card padding="sm"><atlas-text variant="small">3</atlas-text></atlas-card>
          </atlas-grid>
          <atlas-grid columns="4" gap="lg">
            <atlas-card padding="sm"><atlas-text variant="small">1</atlas-text></atlas-card>
            <atlas-card padding="sm"><atlas-text variant="small">2</atlas-text></atlas-card>
            <atlas-card padding="sm"><atlas-text variant="small">3</atlas-text></atlas-card>
            <atlas-card padding="sm"><atlas-text variant="small">4</atlas-text></atlas-card>
          </atlas-grid>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'scroll-area',
  name: 'ScrollArea',
  tag: 'atlas-scroll-area',
  variants: [
    {
      name: 'Vertical with label',
      html: `
        <atlas-scroll-area label="Releases" style="max-height: 140px; border: 1px solid var(--atlas-color-border); border-radius: var(--atlas-radius-md); padding: var(--atlas-space-sm)">
          <atlas-stack gap="xs">
            <atlas-text>v2.4.0 — search palette</atlas-text>
            <atlas-text>v2.3.1 — tab-bar centering</atlas-text>
            <atlas-text>v2.3.0 — sandbox restructure</atlas-text>
            <atlas-text>v2.2.4 — data-table streaming</atlas-text>
            <atlas-text>v2.2.3 — layout editor polish</atlas-text>
            <atlas-text>v2.2.2 — kpi tile fixes</atlas-text>
            <atlas-text>v2.2.1 — tokens refresh</atlas-text>
            <atlas-text>v2.2.0 — chart card</atlas-text>
            <atlas-text>v2.1.0 — multi-select</atlas-text>
          </atlas-stack>
        </atlas-scroll-area>
      `,
    },
    {
      name: 'Horizontal',
      html: `
        <atlas-scroll-area direction="x" style="max-width: 320px; border: 1px solid var(--atlas-color-border); border-radius: var(--atlas-radius-md); padding: var(--atlas-space-sm)">
          <atlas-stack direction="row" gap="sm" style="width: max-content">
            <atlas-card padding="sm"><atlas-text>Card 1</atlas-text></atlas-card>
            <atlas-card padding="sm"><atlas-text>Card 2</atlas-text></atlas-card>
            <atlas-card padding="sm"><atlas-text>Card 3</atlas-text></atlas-card>
            <atlas-card padding="sm"><atlas-text>Card 4</atlas-text></atlas-card>
            <atlas-card padding="sm"><atlas-text>Card 5</atlas-text></atlas-card>
          </atlas-stack>
        </atlas-scroll-area>
      `,
    },
    {
      name: 'Hidden rail',
      html: `
        <atlas-scroll-area rail="hidden" style="max-height: 120px; border: 1px solid var(--atlas-color-border); border-radius: var(--atlas-radius-md); padding: var(--atlas-space-sm)">
          <atlas-stack gap="xs">
            <atlas-text>No scrollbar chrome</atlas-text>
            <atlas-text>Scroll wheel / touch still works</atlas-text>
            <atlas-text>Useful for dense menus</atlas-text>
            <atlas-text>row 4</atlas-text>
            <atlas-text>row 5</atlas-text>
            <atlas-text>row 6</atlas-text>
            <atlas-text>row 7</atlas-text>
            <atlas-text>row 8</atlas-text>
          </atlas-stack>
        </atlas-scroll-area>
      `,
    },
  ],
});


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
