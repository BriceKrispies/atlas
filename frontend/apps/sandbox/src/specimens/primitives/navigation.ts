import { S } from '../_register.ts';

S({
  id: 'tabs',
  name: 'Tabs',
  tag: 'atlas-tabs',
  mount: (demoEl, { onLog }) => {
    const tabs = document.createElement('atlas-tabs') as HTMLElement & {
      tabs: Array<{ value: string; label: string }>;
      value: string;
    };
    tabs.setAttribute('name', 'view');
    tabs.setAttribute('aria-label', 'View');
    tabs.tabs = [
      { value: 'preview', label: 'Preview' },
      { value: 'props', label: 'Props' },
      { value: 'source', label: 'Source' },
      { value: 'notes', label: 'Notes' },
    ];
    tabs.value = 'preview';
    tabs.addEventListener('change', (ev) => {
      onLog('change', (ev as CustomEvent).detail);
    });

    const stretched = document.createElement('atlas-tabs') as HTMLElement & {
      tabs: Array<{ value: string; label: string }>;
      value: string;
    };
    stretched.setAttribute('name', 'size');
    stretched.setAttribute('stretch', '');
    stretched.setAttribute('size', 'sm');
    stretched.setAttribute('aria-label', 'Size');
    stretched.tabs = [
      { value: 'sm', label: 'Small' },
      { value: 'md', label: 'Medium' },
      { value: 'lg', label: 'Large' },
    ];
    stretched.value = 'md';

    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'lg');
    stack.innerHTML = `
      <atlas-stack gap="xs">
        <atlas-label>Content view — default</atlas-label>
      </atlas-stack>
      <atlas-stack gap="xs">
        <atlas-label>Stretched, size="sm"</atlas-label>
      </atlas-stack>
    `;
    stack.children[0]!.appendChild(tabs);
    stack.children[1]!.appendChild(stretched);
    demoEl.appendChild(stack);
    return () => stack.remove();
  },
  configVariants: [{ name: 'default', config: {} }],
});

S({
  id: 'segmented-control',
  name: 'SegmentedControl',
  tag: 'atlas-segmented-control',
  mount: (demoEl, { onLog }) => {
    function makeSeg(attrs: Record<string, string>, options: Array<{ value: string; label: string; disabled?: boolean }>, value?: string): HTMLElement {
      const sc = document.createElement('atlas-segmented-control') as HTMLElement & {
        options: unknown;
        value: unknown;
      };
      for (const [k, v] of Object.entries(attrs)) sc.setAttribute(k, v);
      sc.options = options;
      if (value !== undefined) sc.value = value;
      sc.addEventListener('change', (ev) => onLog('change', (ev as CustomEvent).detail));
      return sc;
    }

    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'lg');
    stack.innerHTML = `
      <atlas-stack gap="xs">
        <atlas-label>Default</atlas-label>
      </atlas-stack>
      <atlas-stack gap="xs">
        <atlas-label>Stretch + size="sm"</atlas-label>
      </atlas-stack>
      <atlas-stack gap="xs">
        <atlas-label>With disabled option</atlas-label>
      </atlas-stack>
      <atlas-stack gap="xs">
        <atlas-label>Fully disabled</atlas-label>
      </atlas-stack>
    `;
    stack.children[0]!.appendChild(makeSeg({ name: 'period', 'aria-label': 'Period' }, [
      { value: 'day', label: 'Day' },
      { value: 'week', label: 'Week' },
      { value: 'month', label: 'Month' },
    ], 'week'));
    stack.children[1]!.appendChild(makeSeg({ name: 'density', size: 'sm', stretch: '', 'aria-label': 'Density' }, [
      { value: 'compact', label: 'Compact' },
      { value: 'comfortable', label: 'Comfortable' },
      { value: 'spacious', label: 'Spacious' },
    ], 'comfortable'));
    stack.children[2]!.appendChild(makeSeg({ name: 'plan', 'aria-label': 'Plan' }, [
      { value: 'free', label: 'Free' },
      { value: 'pro', label: 'Pro' },
      { value: 'enterprise', label: 'Enterprise', disabled: true },
    ], 'pro'));
    stack.children[3]!.appendChild(makeSeg({ name: 'locked', disabled: '', 'aria-label': 'Locked' }, [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ], 'a'));
    demoEl.appendChild(stack);
    return () => stack.remove();
  },
  configVariants: [{ name: 'default', config: {} }],
});

S({
  id: 'accordion',
  name: 'Accordion',
  tag: 'atlas-accordion',
  variants: [
    {
      name: 'Single (default)',
      html: `
        <atlas-accordion>
          <atlas-accordion-item value="general" open>
            General settings
            <atlas-stack gap="sm">
              <atlas-text>Project name, region, timezone.</atlas-text>
              <atlas-text variant="muted">Opening another item auto-collapses this one.</atlas-text>
            </atlas-stack>
          </atlas-accordion-item>
          <atlas-accordion-item value="billing">
            Billing
            <atlas-text>Plan, invoices, payment method.</atlas-text>
          </atlas-accordion-item>
          <atlas-accordion-item value="danger">
            Danger zone
            <atlas-text variant="error">Deleting this project is permanent.</atlas-text>
          </atlas-accordion-item>
        </atlas-accordion>
      `,
    },
    {
      name: 'Multiple + disabled',
      html: `
        <atlas-accordion type="multiple">
          <atlas-accordion-item value="a" open>
            Section A
            <atlas-text>Multiple-mode lets any combination of sections stay open.</atlas-text>
          </atlas-accordion-item>
          <atlas-accordion-item value="b" open>
            Section B
            <atlas-text>Both A and B are open at once.</atlas-text>
          </atlas-accordion-item>
          <atlas-accordion-item value="c" disabled>
            Section C (disabled)
            <atlas-text>Cannot be opened.</atlas-text>
          </atlas-accordion-item>
        </atlas-accordion>
      `,
    },
  ],
});

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
