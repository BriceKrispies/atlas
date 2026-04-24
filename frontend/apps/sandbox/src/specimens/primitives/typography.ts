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

S({
  id: 'label',
  name: 'Label',
  tag: 'atlas-label',
  variants: [
    {
      name: 'Tone variants',
      html: `
        <atlas-stack gap="sm">
          <atlas-label>Default caption</atlas-label>
          <atlas-label tone="strong">Strong caption</atlas-label>
          <atlas-label tone="primary">Primary caption</atlas-label>
          <atlas-label size="xs">Extra small</atlas-label>
        </atlas-stack>
      `,
    },
    {
      name: 'Above a control',
      html: `
        <atlas-stack gap="xs">
          <atlas-label>Plan</atlas-label>
          <atlas-text variant="medium">Pro — $12/mo</atlas-text>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'code',
  name: 'Code',
  tag: 'atlas-code',
  variants: [
    {
      name: 'Inline + tones',
      html: `
        <atlas-stack gap="sm">
          <atlas-text>Run <atlas-code>pnpm dev</atlas-code> to start the sandbox.</atlas-text>
          <atlas-text>The tag is <atlas-code tone="strong">&lt;atlas-button&gt;</atlas-code>.</atlas-text>
          <atlas-text>Unstyled: <atlas-code tone="none">mono only</atlas-code> here.</atlas-text>
        </atlas-stack>
      `,
    },
    {
      name: 'Block',
      html: `
        <atlas-code block>import { AtlasElement } from '@atlas/core';

class Example extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
  }
}
AtlasElement.define('atlas-example', Example);</atlas-code>
      `,
    },
  ],
});

interface CodeEditorConfig {
  language: string;
  theme: string;
  readonly?: boolean;
  value: string;
}

S({
  id: 'code-editor',
  name: 'CodeEditor',
  tag: 'atlas-code-editor',
  mount: (demoEl, { config, onLog }) => {
    const cfg = config as unknown as CodeEditorConfig;
    const el = document.createElement('atlas-code-editor');
    el.setAttribute('language', cfg.language);
    el.setAttribute('theme', cfg.theme);
    if (cfg.readonly) el.setAttribute('readonly', '');
    el.setAttribute('value', cfg.value);
    el.style.height = '360px';
    demoEl.appendChild(el);
    onLog('mount', `lazy-loading Monaco for language=${cfg.language}`);
    return () => el.remove();
  },
  configVariants: [
    {
      name: 'TypeScript',
      config: {
        language: 'typescript',
        theme: 'vs-dark',
        value: `import { AtlasElement } from '@atlas/core';

class Example extends AtlasElement {
  override connectedCallback(): void {
    super.connectedCallback();
    console.log('mounted');
  }
}
AtlasElement.define('atlas-example', Example);
`,
      },
    },
    {
      name: 'JSON',
      config: {
        language: 'json',
        theme: 'vs-dark',
        value: `{
  "surfaceId": "content.pages",
  "required": ["loading", "success", "empty"],
  "selectors": {
    "list": "content.pages.list",
    "empty": "content.pages.empty"
  }
}
`,
      },
    },
    {
      name: 'CSS',
      config: {
        language: 'css',
        theme: 'vs',
        value: `:host {
  display: block;
  padding: var(--atlas-space-lg);
  background: var(--atlas-color-surface);
  border-radius: var(--atlas-radius-md);
}
`,
      },
    },
    {
      name: 'Read-only markdown',
      config: {
        language: 'markdown',
        theme: 'vs',
        readonly: true,
        value: `# Atlas sandbox

A **read-only** editor variant. Useful for rendering fixed
snippets where you still want syntax highlighting and a
scroll gutter.
`,
      },
    },
  ],
});

S({
  id: 'kbd',
  name: 'Kbd',
  tag: 'atlas-kbd',
  variants: [
    {
      name: 'Single keys',
      html: `
        <atlas-stack direction="row" gap="sm" align="center">
          <atlas-kbd>⌘</atlas-kbd>
          <atlas-kbd>Ctrl</atlas-kbd>
          <atlas-kbd>Shift</atlas-kbd>
          <atlas-kbd>Esc</atlas-kbd>
          <atlas-kbd>Enter</atlas-kbd>
          <atlas-kbd>K</atlas-kbd>
        </atlas-stack>
      `,
    },
    {
      name: 'Combinations (inline)',
      html: `
        <atlas-stack gap="sm">
          <atlas-text>Open palette: <atlas-kbd>⌘</atlas-kbd> + <atlas-kbd>K</atlas-kbd></atlas-text>
          <atlas-text>Save: <atlas-kbd size="xs">Ctrl</atlas-kbd> + <atlas-kbd size="xs">S</atlas-kbd></atlas-text>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'link',
  name: 'Link',
  tag: 'atlas-link',
  variants: [
    {
      name: 'Variants',
      html: `
        <atlas-stack gap="sm">
          <atlas-text><atlas-link href="#">Primary link</atlas-link></atlas-text>
          <atlas-text><atlas-link href="#" tone="muted">Muted link</atlas-link></atlas-text>
          <atlas-text><atlas-link href="#" underline="always">Always underlined</atlas-link></atlas-text>
          <atlas-text><atlas-link href="#" underline="none">No underline on hover</atlas-link></atlas-text>
        </atlas-stack>
      `,
    },
    {
      name: 'External (target=_blank)',
      html: `
        <atlas-text><atlas-link href="https://example.com" target="_blank">Open example.com</atlas-link> — auto rel=noopener.</atlas-text>
      `,
    },
  ],
});

S({
  id: 'icon',
  name: 'Icon',
  tag: 'atlas-icon',
  variants: [
    {
      name: 'Sizes + registry sampling',
      html: `
        <atlas-stack gap="md">
          <atlas-stack direction="row" gap="md" align="center">
            <atlas-icon name="menu" size="sm"></atlas-icon>
            <atlas-icon name="menu" size="md"></atlas-icon>
            <atlas-icon name="menu" size="lg"></atlas-icon>
            <atlas-text variant="muted">sm · md · lg</atlas-text>
          </atlas-stack>
          <atlas-stack direction="row" gap="lg" align="center">
            <atlas-icon name="search" label="Search"></atlas-icon>
            <atlas-icon name="chevron-down"></atlas-icon>
            <atlas-icon name="check"></atlas-icon>
            <atlas-icon name="x"></atlas-icon>
            <atlas-icon name="upload"></atlas-icon>
            <atlas-icon name="dash"></atlas-icon>
          </atlas-stack>
        </atlas-stack>
      `,
    },
    {
      name: 'Colour inheritance',
      html: `
        <atlas-stack gap="sm">
          <atlas-text>Inherits text colour: <atlas-icon name="check"></atlas-icon> done.</atlas-text>
          <atlas-text variant="error">In error context: <atlas-icon name="x"></atlas-icon> failed.</atlas-text>
          <atlas-box style="color: var(--atlas-color-primary)"><atlas-icon name="menu"></atlas-icon> primary</atlas-box>
        </atlas-stack>
      `,
    },
  ],
});
