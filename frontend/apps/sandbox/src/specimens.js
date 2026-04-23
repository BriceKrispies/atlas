import { AtlasSandbox } from './sandbox-app.js';
// Vite `?url` import returns a string URL to the served module file.
// This is the bridge between our bundler-driven dev setup and iframe
// isolation: sandboxed frames cannot resolve bare specifiers, so the
// host must hand them a concrete URL.
// The module must export `element` (the widget class); the widget's
// `index.js` does that re-export from `widget.element.js`.
import announcementsWidgetUrl from '@atlas/bundle-standard/widgets/announcements?url';
// @atlas/design registers the atlas-* custom elements. Inline widgets
// inherit the main page's registrations, but an iframe has its own
// realm — the boot script loads this URL before the widget so
// <atlas-box>, <atlas-heading>, etc. are defined in that realm too.
import atlasDesignUrl from '@atlas/design?url';
// Per-widget harness fixtures. Lives next to the widget; imported as
// JSON so it ships as a static asset rather than code.
import announcementsHarnessSpec from '@atlas/bundle-standard/widgets/announcements/harness.fixtures.json';

// Page-template runtime for content-page specimens.
import {
  InMemoryPageStore,
  ValidatingPageStore,
  presetLayouts,
  LayoutRegistry,
  InMemoryLayoutStore,
  ValidatingLayoutStore,
  emptyLayoutDocument,
} from '@atlas/page-templates';
import { seedPages, gallerySeedPages } from '@atlas/bundle-standard/seed-pages';

// Sandbox-scoped layout registry seeded with every bundled preset. Shared
// across all Layout + Layout Gallery specimens so "edit one, see another"
// can be demoed later without re-seeding.
const sandboxLayoutRegistry = new LayoutRegistry();
for (const layout of presetLayouts) {
  sandboxLayoutRegistry.register(layout);
}

// Session-scoped layout store used by the Layout Editor specimens. Saves
// persist across specimen switches until the browser tab reloads.
const sandboxLayoutStore = new ValidatingLayoutStore(
  new InMemoryLayoutStore(
    Object.fromEntries(presetLayouts.map((l) => [l.layoutId, l])),
  ),
);

const S = (spec) => AtlasSandbox.register(spec);


// ── Layout ──────────────────────────────────────────────────────

S({
  id: 'box',
  name: 'Box',
  tag: 'atlas-box',
  group: 'Layout',
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
  group: 'Layout',
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


// ── Typography ──────────────────────────────────────────────────

S({
  id: 'heading',
  name: 'Heading',
  tag: 'atlas-heading',
  group: 'Typography',
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
  group: 'Typography',
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


// ── Interactive ─────────────────────────────────────────────────

S({
  id: 'button',
  name: 'Button',
  tag: 'atlas-button',
  group: 'Interactive',
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
  group: 'Interactive',
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
  id: 'multi-select',
  name: 'Multi Select',
  tag: 'atlas-multi-select',
  group: 'Interactive',
  mount: (demoEl, { config }) => {
    const el = document.createElement('atlas-multi-select');
    for (const [k, v] of Object.entries(config.attrs ?? {})) {
      if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, String(v));
    }
    el.options = config.options ?? [];
    if (Array.isArray(config.value)) el.value = config.value;
    el.style.maxWidth = '420px';
    demoEl.appendChild(el);
    return () => el.remove();
  },
  configVariants: [
    {
      name: 'Default',
      config: {
        attrs: { name: 'tags', label: 'Tags', placeholder: 'Select tags…' },
        options: [
          { value: 'react', label: 'React' },
          { value: 'vue', label: 'Vue' },
          { value: 'svelte', label: 'Svelte' },
          { value: 'angular', label: 'Angular' },
          { value: 'solid', label: 'Solid' },
          { value: 'qwik', label: 'Qwik' },
        ],
      },
    },
    {
      name: 'Searchable',
      config: {
        attrs: { name: 'country', label: 'Country', placeholder: 'Pick countries…', searchable: true },
        options: [
          'Argentina', 'Australia', 'Brazil', 'Canada', 'Chile', 'China', 'Denmark',
          'Egypt', 'France', 'Germany', 'Greece', 'India', 'Indonesia', 'Italy',
          'Japan', 'Kenya', 'Mexico', 'Netherlands', 'Norway', 'Peru', 'Poland',
          'Portugal', 'Spain', 'Sweden', 'Thailand', 'Turkey', 'United Kingdom',
          'United States', 'Vietnam',
        ].map((c) => ({ value: c.toLowerCase().replace(/\s+/g, '-'), label: c })),
      },
    },
    {
      name: 'Pre-selected',
      config: {
        attrs: { name: 'langs', label: 'Languages', searchable: true },
        options: [
          { value: 'en', label: 'English' },
          { value: 'es', label: 'Spanish' },
          { value: 'fr', label: 'French' },
          { value: 'de', label: 'German' },
          { value: 'ja', label: 'Japanese' },
          { value: 'zh', label: 'Chinese' },
        ],
        value: ['en', 'fr', 'ja'],
      },
    },
    {
      name: 'Allow-create (tags)',
      config: {
        attrs: { name: 'labels', label: 'Labels', searchable: true, 'allow-create': true, placeholder: 'Add labels…' },
        options: [
          { value: 'bug', label: 'bug' },
          { value: 'enhancement', label: 'enhancement' },
          { value: 'question', label: 'question' },
        ],
      },
    },
    {
      name: 'Max=2',
      config: {
        attrs: { name: 'picks', label: 'Pick up to 2', max: '2' },
        options: [
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
          { value: 'c', label: 'Gamma' },
          { value: 'd', label: 'Delta' },
        ],
      },
    },
    {
      name: 'Disabled items',
      config: {
        attrs: { name: 'plans', label: 'Plans' },
        options: [
          { value: 'free', label: 'Free' },
          { value: 'pro', label: 'Pro' },
          { value: 'enterprise', label: 'Enterprise', disabled: true },
        ],
      },
    },
    {
      name: 'Error state',
      config: {
        attrs: { name: 'required', label: 'Required', error: 'Pick at least one option', required: true },
        options: [
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ],
      },
    },
    {
      name: 'Disabled',
      config: {
        attrs: { name: 'locked', label: 'Locked field', disabled: true },
        options: [
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ],
        value: ['a'],
      },
    },
  ],
});

S({
  id: 'badge',
  name: 'Badge',
  tag: 'atlas-badge',
  group: 'Interactive',
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
  group: 'Interactive',
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


// ── Navigation ──────────────────────────────────────────────────

S({
  id: 'nav',
  name: 'Nav + Nav Item',
  tag: 'atlas-nav',
  group: 'Navigation',
  states: {
    loading: `
      <atlas-box style="width:220px;background:var(--atlas-color-surface);border:1px solid var(--atlas-color-border);padding:var(--atlas-space-md)">
        <atlas-skeleton rows="4"></atlas-skeleton>
      </atlas-box>
    `,
    error: `
      <atlas-box style="width:220px;background:var(--atlas-color-surface);border:1px solid var(--atlas-color-border);padding:var(--atlas-space-md)">
        <atlas-stack gap="sm">
          <atlas-text variant="error">Failed to load navigation</atlas-text>
          <atlas-button size="sm">Retry</atlas-button>
        </atlas-stack>
      </atlas-box>
    `,
    empty: `
      <atlas-box style="width:220px;background:var(--atlas-color-surface);border:1px solid var(--atlas-color-border);padding:var(--atlas-space-md)">
        <atlas-text variant="muted">No modules available</atlas-text>
      </atlas-box>
    `,
    success: `
      <atlas-box style="width:220px;background:var(--atlas-color-surface);border:1px solid var(--atlas-color-border);padding:var(--atlas-space-md)">
        <atlas-nav label="Example navigation">
          <atlas-heading level="3">Modules</atlas-heading>
          <atlas-nav-item active>Content</atlas-nav-item>
          <atlas-nav-item>Badges</atlas-nav-item>
          <atlas-nav-item>Points</atlas-nav-item>
          <atlas-nav-item>Settings</atlas-nav-item>
        </atlas-nav>
      </atlas-box>
    `,
  },
});


// ── Table ────────────────────────────────────────────────────────

S({
  id: 'table',
  name: 'Table',
  tag: 'atlas-table',
  group: 'Data',
  states: {
    loading: `<atlas-skeleton rows="5"></atlas-skeleton>`,
    error: `
      <atlas-box padding="lg">
        <atlas-stack gap="sm">
          <atlas-text variant="error">Failed to load data: Network error</atlas-text>
          <atlas-box><atlas-button>Retry</atlas-button></atlas-box>
        </atlas-stack>
      </atlas-box>
    `,
    empty: `
      <atlas-stack gap="md" align="center" padding="xl">
        <atlas-heading level="2">No pages yet</atlas-heading>
        <atlas-text variant="muted" block>Create your first page to get started.</atlas-text>
        <atlas-button variant="primary">Create page</atlas-button>
      </atlas-stack>
    `,
    success: `
      <atlas-table label="Example data">
        <atlas-table-head>
          <atlas-row>
            <atlas-table-cell header>Name</atlas-table-cell>
            <atlas-table-cell header>Status</atlas-table-cell>
            <atlas-table-cell header>Updated</atlas-table-cell>
            <atlas-table-cell header>Actions</atlas-table-cell>
          </atlas-row>
        </atlas-table-head>
        <atlas-table-body>
          <atlas-row>
            <atlas-table-cell><atlas-text variant="medium">Welcome Page</atlas-text></atlas-table-cell>
            <atlas-table-cell><atlas-badge status="published">published</atlas-badge></atlas-table-cell>
            <atlas-table-cell><atlas-text variant="muted">Apr 10, 2026</atlas-text></atlas-table-cell>
            <atlas-table-cell><atlas-button variant="danger" size="sm">Delete</atlas-button></atlas-table-cell>
          </atlas-row>
          <atlas-row>
            <atlas-table-cell><atlas-text variant="medium">About Us</atlas-text></atlas-table-cell>
            <atlas-table-cell><atlas-badge status="draft">draft</atlas-badge></atlas-table-cell>
            <atlas-table-cell><atlas-text variant="muted">Apr 8, 2026</atlas-text></atlas-table-cell>
            <atlas-table-cell><atlas-button variant="danger" size="sm">Delete</atlas-button></atlas-table-cell>
          </atlas-row>
          <atlas-row>
            <atlas-table-cell><atlas-text variant="medium">FAQ</atlas-text></atlas-table-cell>
            <atlas-table-cell><atlas-badge status="archived">archived</atlas-badge></atlas-table-cell>
            <atlas-table-cell><atlas-text variant="muted">Mar 15, 2026</atlas-text></atlas-table-cell>
            <atlas-table-cell><atlas-button variant="danger" size="sm">Delete</atlas-button></atlas-table-cell>
          </atlas-row>
        </atlas-table-body>
      </atlas-table>
    `,
  },
  variants: [
    {
      name: 'Header only',
      html: `
        <atlas-table label="Empty table">
          <atlas-table-head>
            <atlas-row>
              <atlas-table-cell header>Name</atlas-table-cell>
              <atlas-table-cell header>Status</atlas-table-cell>
              <atlas-table-cell header>Updated</atlas-table-cell>
            </atlas-row>
          </atlas-table-head>
        </atlas-table>
      `,
    },
  ],
});


// ── Compositions ────────────────────────────────────────────────

S({
  id: 'page-header',
  name: 'Page Header',
  tag: 'atlas-stack',
  group: 'Compositions',
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

// ── Surface States ─────────────────────────────────────────────

S({
  id: 'surface-pages-list',
  name: 'Pages List Surface',
  tag: 'pages-list-page',
  group: 'Surface States',
  states: {
    loading: `<atlas-skeleton rows="5"></atlas-skeleton>`,
    error: `
      <atlas-box padding="lg">
        <atlas-stack gap="sm">
          <atlas-text variant="error">Failed to load pages: Connection refused</atlas-text>
          <atlas-box><atlas-button>Retry</atlas-button></atlas-box>
        </atlas-stack>
      </atlas-box>
    `,
    empty: `
      <atlas-stack gap="md" align="center" padding="xl">
        <atlas-heading level="2">No pages yet</atlas-heading>
        <atlas-text variant="muted" block>Create your first page to get started.</atlas-text>
        <atlas-button variant="primary">Create page</atlas-button>
      </atlas-stack>
    `,
    success: `
      <atlas-stack gap="lg">
        <atlas-stack direction="row" justify="space-between" align="center">
          <atlas-heading level="1">Content Pages</atlas-heading>
          <atlas-button variant="primary">Create page</atlas-button>
        </atlas-stack>
        <atlas-table label="Content pages">
          <atlas-table-head>
            <atlas-row>
              <atlas-table-cell header>Title</atlas-table-cell>
              <atlas-table-cell header>Slug</atlas-table-cell>
              <atlas-table-cell header>Status</atlas-table-cell>
              <atlas-table-cell header>Updated</atlas-table-cell>
              <atlas-table-cell header>Actions</atlas-table-cell>
            </atlas-row>
          </atlas-table-head>
          <atlas-table-body>
            <atlas-row>
              <atlas-table-cell><atlas-text variant="medium">Welcome Page</atlas-text></atlas-table-cell>
              <atlas-table-cell><atlas-text variant="muted">/welcome</atlas-text></atlas-table-cell>
              <atlas-table-cell><atlas-badge status="published">published</atlas-badge></atlas-table-cell>
              <atlas-table-cell><atlas-text variant="muted">Apr 10, 2026</atlas-text></atlas-table-cell>
              <atlas-table-cell><atlas-button variant="danger" size="sm">Delete</atlas-button></atlas-table-cell>
            </atlas-row>
            <atlas-row>
              <atlas-table-cell><atlas-text variant="medium">About Us</atlas-text></atlas-table-cell>
              <atlas-table-cell><atlas-text variant="muted">/about-us</atlas-text></atlas-table-cell>
              <atlas-table-cell><atlas-badge status="draft">draft</atlas-badge></atlas-table-cell>
              <atlas-table-cell><atlas-text variant="muted">Apr 8, 2026</atlas-text></atlas-table-cell>
              <atlas-table-cell><atlas-button variant="danger" size="sm">Delete</atlas-button></atlas-table-cell>
            </atlas-row>
          </atlas-table-body>
        </atlas-table>
      </atlas-stack>
    `,
  },
});

S({
  id: 'surface-detail',
  name: 'Detail Surface',
  tag: 'atlas-box',
  group: 'Surface States',
  states: {
    loading: `<atlas-skeleton rows="3"></atlas-skeleton>`,
    error: `
      <atlas-box padding="lg">
        <atlas-stack gap="sm">
          <atlas-text variant="error">Unable to load badge details: 404 Not Found</atlas-text>
          <atlas-box><atlas-button>Retry</atlas-button></atlas-box>
        </atlas-stack>
      </atlas-box>
    `,
    empty: `
      <atlas-stack gap="md" align="center" padding="xl">
        <atlas-heading level="2">Badge not found</atlas-heading>
        <atlas-text variant="muted" block>This badge may have been deleted.</atlas-text>
      </atlas-stack>
    `,
    success: `
      <atlas-stack gap="lg">
        <atlas-stack gap="xs">
          <atlas-heading level="1">Gold Star</atlas-heading>
          <atlas-text variant="muted">Awarded for outstanding contributions</atlas-text>
        </atlas-stack>
        <atlas-stack direction="row" gap="lg">
          <atlas-stack gap="xs">
            <atlas-text variant="small">Status</atlas-text>
            <atlas-badge status="published">active</atlas-badge>
          </atlas-stack>
          <atlas-stack gap="xs">
            <atlas-text variant="small">Awarded</atlas-text>
            <atlas-text variant="medium">142 times</atlas-text>
          </atlas-stack>
          <atlas-stack gap="xs">
            <atlas-text variant="small">Created</atlas-text>
            <atlas-text variant="muted">Jan 15, 2026</atlas-text>
          </atlas-stack>
        </atlas-stack>
        <atlas-stack direction="row" gap="sm" justify="end">
          <atlas-button variant="ghost">Archive</atlas-button>
          <atlas-button variant="primary">Edit badge</atlas-button>
        </atlas-stack>
      </atlas-stack>
    `,
  },
});


// ── Compositions ────────────────────────────────────────────────

S({
  id: 'form-group',
  name: 'Form Group',
  tag: 'atlas-stack',
  group: 'Compositions',
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

S({
  id: 'shell-header',
  name: 'Shell Header',
  tag: 'atlas-box',
  group: 'Compositions',
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


// ── Widgets ─────────────────────────────────────────────────────
//
// Widget specimens use the live `mount` shape: the sandbox creates a
// real <widget-host> and wires a sandbox-local capability bridge that
// returns fake data so the widget runs end-to-end without a backend.
// This is the same contract the admin app will use in production, just
// with mocked capabilities. See specs/crosscut/widgets.md.

// Widget specimen: a single top-level <widget-harness> that owns its own
// config-variant switcher, live mediator/bridge trace logs, and a
// synthetic-publish panel. The sandbox shell just hands it a container.
function mountAnnouncementsHarness(demoEl) {
  const harness = document.createElement('widget-harness');
  harness.spec = announcementsHarnessSpec;
  harness.widgetId = 'content.announcements';
  harness.resolveWidgetModuleUrl = (widgetId) =>
    widgetId === 'content.announcements'
      ? { url: announcementsWidgetUrl, supportUrls: [atlasDesignUrl] }
      : null;
  demoEl.appendChild(harness);
  return () => {
    try { harness.remove(); } catch { /* already detached */ }
  };
}

S({
  id: 'widget.content.announcements',
  name: 'Announcements',
  tag: 'widget-harness',
  group: 'Widgets',
  mount: mountAnnouncementsHarness,
  // No configVariants — the harness owns its own variant switcher from
  // the fixture file so variants stay colocated with the widget.
  configVariants: [{ name: 'Harness', config: {} }],
});


// ── Pages ───────────────────────────────────────────────────────
//
// Content-page specimens mount real <content-page> elements backed by a
// session-shared InMemoryPageStore. The store is seeded once with the
// three bundle seed pages at module load — edits made in edit-mode
// specimens persist across specimen switches (but reset on page reload).
//
// Each page gets two config variants: View (read-only) and Edit (with
// the widget palette + drag/drop). Switching between them re-mounts the
// <content-page>, which re-reads from the store, so edits flush through
// immediately on a re-render.

const sandboxPageStore = new ValidatingPageStore(new InMemoryPageStore());
for (const doc of seedPages) {
  // Fire-and-forget — the InMemoryPageStore save is synchronous under
  // the hood; we await the promise before the first specimen mounts
  // via the await-once pattern below.
  sandboxPageStore.save(doc.pageId, doc);
}
for (const doc of gallerySeedPages) {
  sandboxPageStore.save(doc.pageId, doc);
}

// Sandbox-local capability bridge — announcements uses `backend.query`
// to fetch media files in "file" mode. The seed pages only use "text"
// mode so this is defensive, but wiring it here means adding a file
// variant later doesn't need a new specimen.
const sandboxCapabilities = {
  'backend.query': async ({ path }) => {
    if (typeof path === 'string' && path.startsWith('/media/files/')) {
      const fileId = path.slice('/media/files/'.length);
      return {
        id: fileId,
        filename: `${fileId}.png`,
        url: 'https://placehold.co/600x200?text=Sample+Media',
      };
    }
    return null;
  },
};

function mountContentPage(demoEl, { config, onLog }) {
  const { pageId, edit } = config;
  const page = document.createElement('content-page');
  page.pageId = pageId;
  page.pageStore = sandboxPageStore;
  // layoutRegistry resolves layoutId-based pages. Legacy templateId-based
  // pages keep using templateRegistry (its default wired in by the bundle
  // import). Both paths coexist.
  page.layoutRegistry = sandboxLayoutRegistry;
  page.principal = { id: 'u_sandbox', roles: [] };
  page.tenantId = 'acme';
  page.correlationId = `cid-sandbox-${pageId}-${Date.now()}`;
  page.capabilities = sandboxCapabilities;
  page.edit = edit === true;
  page.onMediatorTrace = (evt) => onLog('mediator', evt);
  page.onCapabilityTrace = (evt) => onLog('capability', evt);
  demoEl.appendChild(page);
  onLog('page-mount', { pageId, edit: page.edit });
  return () => {
    try { page.remove(); } catch { /* already detached */ }
  };
}

for (const doc of seedPages) {
  S({
    id: `page.${doc.pageId}`,
    name: doc.meta?.title ?? doc.pageId,
    tag: 'content-page',
    group: 'Pages',
    mount: mountContentPage,
    configVariants: [
      { name: 'View', config: { pageId: doc.pageId, edit: false } },
      { name: 'Edit', config: { pageId: doc.pageId, edit: true } },
    ],
  });
}


// ── Layout Gallery ──────────────────────────────────────────────
//
// Each gallery specimen mounts the same announcements widget set into a
// different page template so layouts can be compared side-by-side. The
// seed docs live in @atlas/bundle-standard/seed-pages and are saved into
// the shared sandboxPageStore above. Both View and Edit variants are
// wired so the drag/drop palette can be exercised against each template.

for (const doc of gallerySeedPages) {
  const shortName =
    doc.meta?.title?.replace(/^Gallery\s*—\s*/i, '') ?? doc.templateId;
  S({
    id: `gallery.${doc.pageId}`,
    name: shortName,
    tag: 'content-page',
    group: 'Layout Gallery',
    mount: mountContentPage,
    configVariants: [
      { name: 'View', config: { pageId: doc.pageId, edit: false } },
      { name: 'Edit', config: { pageId: doc.pageId, edit: true } },
    ],
  });
}


// ── Layouts ─────────────────────────────────────────────────────
//
// Data-driven layouts rendered via <atlas-layout>. Each specimen mounts a
// preset layout document and labels each slot inline so you can see the
// grid placement (col/row + span). This is the Phase 1 runtime proof:
// no bespoke template class, no CSS file — just a JSON layout document
// and an <atlas-layout> element that positions sections on a grid.

function mountLayoutPreview(demoEl, { config }) {
  const layoutDoc = sandboxLayoutRegistry.get(config.layoutId);
  const el = document.createElement('atlas-layout');
  el.layout = layoutDoc;
  demoEl.appendChild(el);
  // Label each section so the slot grid is visible at a glance. These
  // labels live INSIDE the section so they scroll with its overflow; the
  // section itself keeps its fixed footprint regardless.
  for (const slot of layoutDoc.slots) {
    const sec = el.querySelector(`:scope > section[data-slot="${slot.name}"]`);
    if (!sec) continue;
    sec.innerHTML = `
      <atlas-stack gap="xs" padding="md" style="height:100%;justify-content:center;align-items:center;text-align:center">
        <atlas-text variant="medium">${slot.name}</atlas-text>
        <atlas-text variant="muted">
          col ${slot.col} · row ${slot.row} · span ${slot.colSpan}×${slot.rowSpan}
        </atlas-text>
      </atlas-stack>
    `;
  }
  return () => {
    try { el.remove(); } catch { /* already detached */ }
  };
}

for (const layout of presetLayouts) {
  const shortName = layout.displayName ?? layout.layoutId;
  S({
    id: `layout.${layout.layoutId}`,
    name: shortName,
    tag: 'atlas-layout',
    group: 'Layouts',
    mount: mountLayoutPreview,
    configVariants: [
      { name: 'Preview', config: { layoutId: layout.layoutId } },
    ],
  });
}


// ── Layout Editor ───────────────────────────────────────────────
//
// Live editor specimens. Each mounts <atlas-layout-editor> seeded either
// with a preset (so you can tweak one) or with a blank canvas. Saves go
// through the sandboxLayoutStore and are immediately observable by other
// specimens that read from it.

function mountLayoutEditor(demoEl, { config, onLog }) {
  const seedId = config.layoutId ?? null;
  const seedDoc = seedId
    ? (sandboxLayoutStore.get
        ? null  /* async — populated below */
        : null)
    : emptyLayoutDocument({
        layoutId: `sandbox.${Date.now().toString(36)}`,
        displayName: 'Untitled layout',
      });

  const editor = document.createElement('atlas-layout-editor');
  editor.onChange = (doc) => onLog('layout-editor.change', {
    layoutId: doc.layoutId,
    slotCount: doc.slots.length,
  });
  editor.onSave = async (doc) => {
    await sandboxLayoutStore.save(doc.layoutId, doc);
    // Mirror saved layouts into the registry so preview / content-page
    // specimens pick them up without extra plumbing.
    try {
      sandboxLayoutRegistry.register(doc);
    } catch {
      /* duplicate name with different shape — registry throws; ignore */
    }
    onLog('layout-editor.save', { layoutId: doc.layoutId });
  };

  (async () => {
    if (seedId) {
      const stored = await sandboxLayoutStore.get(seedId);
      editor.layout = stored ?? sandboxLayoutRegistry.get(seedId);
    } else {
      editor.layout = seedDoc;
    }
  })();

  demoEl.appendChild(editor);
  return () => {
    try { editor.remove(); } catch { /* already detached */ }
  };
}

S({
  id: 'layout-editor.blank',
  name: 'Blank canvas',
  tag: 'atlas-layout-editor',
  group: 'Layout Editor',
  mount: mountLayoutEditor,
  configVariants: [{ name: 'New layout', config: {} }],
});

for (const layout of presetLayouts) {
  S({
    id: `layout-editor.${layout.layoutId}`,
    name: layout.displayName ?? layout.layoutId,
    tag: 'atlas-layout-editor',
    group: 'Layout Editor',
    mount: mountLayoutEditor,
    configVariants: [
      { name: 'Edit preset', config: { layoutId: layout.layoutId } },
    ],
  });
}


// ── @atlas/widgets ──────────────────────────────────────────────

const SAMPLE_TABLE_ROWS = [
  { id: 1,  title: 'Welcome Page',          status: 'published', score: 82, updated: '2026-04-10' },
  { id: 2,  title: 'About Us',              status: 'draft',     score: 47, updated: '2026-04-08' },
  { id: 3,  title: 'FAQ',                   status: 'archived',  score: 5,  updated: '2026-03-15' },
  { id: 4,  title: 'Careers',               status: 'published', score: 64, updated: '2026-04-02' },
  { id: 5,  title: 'Press',                 status: 'published', score: 33, updated: '2026-02-28' },
  { id: 6,  title: 'Privacy Policy',        status: 'published', score: 12, updated: '2026-01-14' },
  { id: 7,  title: 'Terms of Service',      status: 'published', score: 9,  updated: '2026-01-14' },
  { id: 8,  title: 'Support Home',          status: 'draft',     score: 71, updated: '2026-04-20' },
  { id: 9,  title: 'Release Notes',         status: 'published', score: 58, updated: '2026-04-18' },
  { id: 10, title: 'Changelog',             status: 'published', score: 22, updated: '2026-04-17' },
  { id: 11, title: 'Developer Blog',        status: 'draft',     score: 77, updated: '2026-04-15' },
  { id: 12, title: 'Security Advisories',   status: 'archived',  score: 3,  updated: '2025-11-02' },
];

const SAMPLE_TABLE_COLUMNS = [
  { key: 'title',   label: 'Title',  sortable: true, filter: { type: 'text' } },
  { key: 'status',  label: 'Status', sortable: true, filter: { type: 'select' }, format: 'status' },
  { key: 'score',   label: 'Score',  sortable: true, filter: { type: 'range' }, align: 'end', format: 'number' },
  { key: 'updated', label: 'Updated', sortable: true, format: 'date' },
];

import { arrayDataSource } from '@atlas/widgets';

function mountDataTable(demo, { config, onLog }) {
  const table = document.createElement('atlas-data-table');
  table.setAttribute('name', 'table');
  table.setAttribute('label', 'Sample pages');
  if (config.pageSize != null) table.setAttribute('page-size', String(config.pageSize));
  if (config.selection) table.setAttribute('selection', config.selection);
  if (config.emptyHeading) table.setAttribute('empty-heading', config.emptyHeading);
  table.columns = SAMPLE_TABLE_COLUMNS;

  // Streaming variant wires an arrayDataSource (which supports subscribe)
  // and hangs an imperative emit handle on window.__atlasTestDataSource
  // so Playwright can inject patches via page.evaluate.
  if (config.streaming) {
    const ds = arrayDataSource(config.data ?? SAMPLE_TABLE_ROWS);
    table.dataSource = ds;
    // eslint-disable-next-line no-restricted-globals
    (typeof window !== 'undefined' ? window : globalThis).__atlasTestDataSource = ds;
  } else {
    table.data = config.data ?? SAMPLE_TABLE_ROWS;
  }

  const events = [
    'sort-change', 'filter-change', 'filter-cleared', 'page-change',
    'row-selected', 'row-unselected', 'row-activated', 'stream-patch-applied',
  ];
  const handlers = events.map((ev) => {
    const h = (e) => onLog(ev, e.detail ?? {});
    table.addEventListener(ev, h);
    return [ev, h];
  });

  demo.appendChild(table);
  return () => {
    for (const [ev, h] of handlers) table.removeEventListener(ev, h);
    table.remove();
    // eslint-disable-next-line no-restricted-globals
    if (typeof window !== 'undefined' && window.__atlasTestDataSource) {
      delete window.__atlasTestDataSource;
    }
  };
}

S({
  id: 'widgets.data-table',
  name: 'Data table',
  tag: 'atlas-data-table',
  group: 'Widgets',
  mount: mountDataTable,
  configVariants: [
    { name: 'Default',    config: { pageSize: 5 } },
    { name: 'Small page', config: { pageSize: 3 } },
    { name: 'No pagination', config: { pageSize: 0 } },
    { name: 'Single-select', config: { pageSize: 5, selection: 'single' } },
    { name: 'Multi-select',  config: { pageSize: 5, selection: 'multi' } },
    { name: 'Streaming',   config: { pageSize: 5, streaming: true } },
    { name: 'Empty',  config: { pageSize: 5, data: [], emptyHeading: 'No results found' } },
  ],
});


// ── Charts ──────────────────────────────────────────────────────

const SAMPLE_SERIES = {
  series: [
    { name: 'Logins',    values: [1, 3, 5, 4, 7, 9, 12] },
    { name: 'Sign-ups',  values: [0, 1, 2, 3, 4, 6, 8] },
  ],
};

const SAMPLE_TIME_SERIES = {
  series: [
    {
      name: 'Revenue',
      values: [
        { x: '2026-01-01', y: 120 },
        { x: '2026-02-01', y: 180 },
        { x: '2026-03-01', y: 160 },
        { x: '2026-04-01', y: 220 },
      ],
    },
  ],
};

const SAMPLE_BAR = {
  series: [
    { name: 'Desktop', values: [{ x: 'Q1', y: 30 }, { x: 'Q2', y: 45 }, { x: 'Q3', y: 60 }, { x: 'Q4', y: 50 }] },
    { name: 'Mobile',  values: [{ x: 'Q1', y: 20 }, { x: 'Q2', y: 35 }, { x: 'Q3', y: 40 }, { x: 'Q4', y: 55 }] },
  ],
};

const SAMPLE_SLICES = {
  slices: [
    { label: 'Blog',   value: 40 },
    { label: 'Docs',   value: 25 },
    { label: 'FAQ',    value: 15 },
    { label: 'Home',   value: 20 },
  ],
};

function mountChart(demo, { config, onLog }) {
  const chart = document.createElement('atlas-chart');
  chart.setAttribute('name', 'chart');
  chart.setAttribute('type', config.type ?? 'line');
  if (config.height) chart.setAttribute('height', config.height);
  if (config.label) chart.setAttribute('label', config.label);
  if (config.showLegend) chart.setAttribute('show-legend', '');
  if (config.innerRadius != null) chart.setAttribute('inner-radius', String(config.innerRadius));
  chart.data = config.data;

  const handler = (e) => onLog(e.type, e.detail ?? {});
  chart.addEventListener('point-focus', handler);
  chart.addEventListener('point-blur', handler);

  demo.appendChild(chart);
  return () => {
    chart.removeEventListener('point-focus', handler);
    chart.removeEventListener('point-blur', handler);
    chart.remove();
  };
}

S({
  id: 'widgets.chart',
  name: 'Chart',
  tag: 'atlas-chart',
  group: 'Widgets',
  mount: mountChart,
  configVariants: [
    { name: 'Line (simple)',    config: { type: 'line',  data: SAMPLE_SERIES, label: 'Logins vs sign-ups', showLegend: true } },
    { name: 'Line (time)',      config: { type: 'line',  data: SAMPLE_TIME_SERIES, label: 'Monthly revenue' } },
    { name: 'Area',             config: { type: 'area',  data: SAMPLE_SERIES, showLegend: true } },
    { name: 'Bar',              config: { type: 'bar',   data: SAMPLE_BAR, showLegend: true } },
    { name: 'Stacked bar',      config: { type: 'stacked-bar', data: SAMPLE_BAR, showLegend: true } },
    { name: 'Pie',              config: { type: 'pie',   data: SAMPLE_SLICES } },
    { name: 'Donut',            config: { type: 'donut', data: SAMPLE_SLICES, innerRadius: 0.6 } },
  ],
});
