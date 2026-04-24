import { S } from '../_register.ts';

S({
  id: 'nav',
  name: 'Nav + Nav Item',
  tag: 'atlas-nav',
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
