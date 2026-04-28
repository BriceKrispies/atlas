import { S } from '../_register.ts';

interface MultiSelectConfig {
  attrs?: Record<string, string | number | boolean>;
  options?: Array<string | { value: string; label: string; disabled?: boolean }>;
  value?: string[];
}

S({
  id: 'multi-select',
  name: 'Multi Select',
  tag: 'atlas-multi-select',
  mount: (demoEl, { config }) => {
    const cfg = config as MultiSelectConfig;
    const el = document.createElement('atlas-multi-select') as HTMLElement & {
      options: unknown;
      value: unknown;
    };
    for (const [k, v] of Object.entries(cfg.attrs ?? {})) {
      if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, String(v));
    }
    el.options = cfg.options ?? [];
    if (Array.isArray(cfg.value)) el.value = cfg.value;
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
  id: 'select',
  name: 'Select',
  tag: 'atlas-select',
  mount: (el, { onLog }) => {
    const sel = document.createElement('atlas-select');
    sel.setAttribute('label', 'Status');
    sel.setAttribute('placeholder', 'Choose one');
    sel.options = [
      { value: 'draft', label: 'Draft' },
      { value: 'review', label: 'In review' },
      { value: 'published', label: 'Published' },
      { value: 'archived', label: 'Archived', disabled: true },
    ];
    sel.addEventListener('change', (ev) => {
      onLog('change', (ev as CustomEvent).detail);
    });
    el.appendChild(sel);
    return () => {};
  },
  configVariants: [
    { name: 'default', config: {} },
  ],
});

S({
  id: 'checkbox',
  name: 'Checkbox',
  tag: 'atlas-checkbox',
  variants: [
    {
      name: 'Default, checked, indeterminate, disabled',
      html: `
        <atlas-stack gap="sm">
          <atlas-checkbox label="Unchecked"></atlas-checkbox>
          <atlas-checkbox label="Checked" checked></atlas-checkbox>
          <atlas-checkbox label="Indeterminate" indeterminate></atlas-checkbox>
          <atlas-checkbox label="Required" required></atlas-checkbox>
          <atlas-checkbox label="Disabled" disabled></atlas-checkbox>
          <atlas-checkbox label="Disabled + checked" disabled checked></atlas-checkbox>
        </atlas-stack>
      `,
    },
    {
      name: 'Long label wraps',
      html: `
        <atlas-box style="max-width: 320px">
          <atlas-checkbox label="I agree to the Terms of Service, the Privacy Policy, and understand this is a demonstration label that needs to wrap across multiple lines."></atlas-checkbox>
        </atlas-box>
      `,
    },
  ],
});

S({
  id: 'radio-group',
  name: 'Radio / RadioGroup',
  tag: 'atlas-radio-group',
  variants: [
    {
      name: 'Vertical (default), one selected',
      html: `
        <atlas-radio-group label="Plan" value="pro">
          <atlas-radio value="free" label="Free"></atlas-radio>
          <atlas-radio value="pro" label="Pro — $12/mo"></atlas-radio>
          <atlas-radio value="team" label="Team — $40/mo"></atlas-radio>
        </atlas-radio-group>
      `,
    },
    {
      name: 'Horizontal',
      html: `
        <atlas-radio-group label="Priority" value="medium" orientation="row">
          <atlas-radio value="low" label="Low"></atlas-radio>
          <atlas-radio value="medium" label="Medium"></atlas-radio>
          <atlas-radio value="high" label="High"></atlas-radio>
        </atlas-radio-group>
      `,
    },
    {
      name: 'Disabled option + disabled group',
      html: `
        <atlas-stack gap="lg">
          <atlas-radio-group label="With one disabled option" value="a">
            <atlas-radio value="a" label="Option A"></atlas-radio>
            <atlas-radio value="b" label="Option B (disabled)" disabled></atlas-radio>
            <atlas-radio value="c" label="Option C"></atlas-radio>
          </atlas-radio-group>
          <atlas-radio-group label="Fully disabled group" value="b" disabled>
            <atlas-radio value="a" label="A"></atlas-radio>
            <atlas-radio value="b" label="B"></atlas-radio>
          </atlas-radio-group>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'switch',
  name: 'Switch',
  tag: 'atlas-switch',
  variants: [
    {
      name: 'Default, on, disabled',
      html: `
        <atlas-stack gap="sm">
          <atlas-switch label="Off"></atlas-switch>
          <atlas-switch label="On" checked></atlas-switch>
          <atlas-switch label="Disabled" disabled></atlas-switch>
          <atlas-switch label="Disabled + on" disabled checked></atlas-switch>
        </atlas-stack>
      `,
    },
  ],
});
