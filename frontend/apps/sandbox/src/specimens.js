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
