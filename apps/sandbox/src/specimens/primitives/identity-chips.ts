import { S } from '../_register.ts';

// ─────────────────────────────────────────────────────────────────
// Identity primitives
// ─────────────────────────────────────────────────────────────────

S({
  id: 'avatar',
  name: 'Avatar',
  tag: 'atlas-avatar',
  variants: [
    {
      name: 'Image source — sizes',
      html: `
        <atlas-stack direction="row" gap="md" align="center">
          <atlas-avatar size="xs" name="Ada Lovelace" src="https://i.pravatar.cc/64?img=47"></atlas-avatar>
          <atlas-avatar size="sm" name="Ada Lovelace" src="https://i.pravatar.cc/64?img=47"></atlas-avatar>
          <atlas-avatar size="md" name="Ada Lovelace" src="https://i.pravatar.cc/64?img=47"></atlas-avatar>
          <atlas-avatar size="lg" name="Ada Lovelace" src="https://i.pravatar.cc/64?img=47"></atlas-avatar>
          <atlas-avatar size="xl" name="Ada Lovelace" src="https://i.pravatar.cc/64?img=47"></atlas-avatar>
        </atlas-stack>
      `,
    },
    {
      name: 'Initials fallback (no src)',
      html: `
        <atlas-stack direction="row" gap="md" align="center">
          <atlas-avatar name="Ada Lovelace"></atlas-avatar>
          <atlas-avatar name="Grace Hopper"></atlas-avatar>
          <atlas-avatar name="Linus"></atlas-avatar>
          <atlas-avatar name=""></atlas-avatar>
        </atlas-stack>
      `,
    },
    {
      name: 'Broken image URL → falls back without flash',
      html: `
        <atlas-stack direction="row" gap="md" align="center">
          <atlas-avatar name="Ada Lovelace" src="https://invalid.example.test/missing.png"></atlas-avatar>
          <atlas-avatar name="Grace Hopper" src="data:image/png;base64,not-a-real-image"></atlas-avatar>
          <atlas-text variant="muted">Both render initials.</atlas-text>
        </atlas-stack>
      `,
    },
    {
      name: 'Status dots',
      html: `
        <atlas-stack direction="row" gap="md" align="center">
          <atlas-avatar name="Online User" status="online" size="lg"></atlas-avatar>
          <atlas-avatar name="Away User"   status="away"   size="lg"></atlas-avatar>
          <atlas-avatar name="Busy User"   status="busy"   size="lg"></atlas-avatar>
          <atlas-avatar name="Offline User" status="offline" size="lg"></atlas-avatar>
        </atlas-stack>
      `,
    },
    {
      name: 'Shapes',
      html: `
        <atlas-stack direction="row" gap="md" align="center">
          <atlas-avatar name="Circle One" shape="circle"  size="lg"></atlas-avatar>
          <atlas-avatar name="Round Two"  shape="rounded" size="lg"></atlas-avatar>
          <atlas-avatar name="Square Three" shape="square" size="lg"></atlas-avatar>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'avatar-group',
  name: 'Avatar Group',
  tag: 'atlas-avatar-group',
  variants: [
    {
      name: '2 members',
      html: `
        <atlas-avatar-group>
          <atlas-avatar name="Ada Lovelace"></atlas-avatar>
          <atlas-avatar name="Grace Hopper"></atlas-avatar>
        </atlas-avatar-group>
      `,
    },
    {
      name: '4 members (default max)',
      html: `
        <atlas-avatar-group>
          <atlas-avatar name="Ada Lovelace"></atlas-avatar>
          <atlas-avatar name="Grace Hopper"></atlas-avatar>
          <atlas-avatar name="Linus Torvalds"></atlas-avatar>
          <atlas-avatar name="Margaret Hamilton"></atlas-avatar>
        </atlas-avatar-group>
      `,
    },
    {
      name: '10 members with max=3 (overflow chip)',
      html: `
        <atlas-avatar-group max="3">
          <atlas-avatar name="Ada Lovelace"></atlas-avatar>
          <atlas-avatar name="Grace Hopper"></atlas-avatar>
          <atlas-avatar name="Linus Torvalds"></atlas-avatar>
          <atlas-avatar name="Margaret Hamilton"></atlas-avatar>
          <atlas-avatar name="Donald Knuth"></atlas-avatar>
          <atlas-avatar name="Edsger Dijkstra"></atlas-avatar>
          <atlas-avatar name="Alan Turing"></atlas-avatar>
          <atlas-avatar name="Barbara Liskov"></atlas-avatar>
          <atlas-avatar name="John von Neumann"></atlas-avatar>
          <atlas-avatar name="Niklaus Wirth"></atlas-avatar>
        </atlas-avatar-group>
      `,
    },
    {
      name: 'With images',
      html: `
        <atlas-avatar-group max="4">
          <atlas-avatar name="Ada"   src="https://i.pravatar.cc/64?img=1"></atlas-avatar>
          <atlas-avatar name="Grace" src="https://i.pravatar.cc/64?img=2"></atlas-avatar>
          <atlas-avatar name="Linus" src="https://i.pravatar.cc/64?img=3"></atlas-avatar>
          <atlas-avatar name="Margaret" src="https://i.pravatar.cc/64?img=4"></atlas-avatar>
          <atlas-avatar name="Donald"  src="https://i.pravatar.cc/64?img=5"></atlas-avatar>
          <atlas-avatar name="Edsger"  src="https://i.pravatar.cc/64?img=6"></atlas-avatar>
        </atlas-avatar-group>
      `,
    },
  ],
});

S({
  id: 'tag',
  name: 'Tag',
  tag: 'atlas-tag',
  variants: [
    {
      name: 'Variants',
      html: `
        <atlas-stack direction="row" gap="sm" align="center" wrap>
          <atlas-tag>neutral</atlas-tag>
          <atlas-tag variant="info">info</atlas-tag>
          <atlas-tag variant="success">success</atlas-tag>
          <atlas-tag variant="warning">warning</atlas-tag>
          <atlas-tag variant="danger">danger</atlas-tag>
        </atlas-stack>
      `,
    },
    {
      name: 'Sizes',
      html: `
        <atlas-stack direction="row" gap="sm" align="center" wrap>
          <atlas-tag size="sm">small</atlas-tag>
          <atlas-tag size="md">medium</atlas-tag>
          <atlas-tag variant="info" size="md">info md</atlas-tag>
        </atlas-stack>
      `,
    },
  ],
});

// ─────────────────────────────────────────────────────────────────
// Chip primitives
// ─────────────────────────────────────────────────────────────────

S({
  id: 'chip',
  name: 'Chip',
  tag: 'atlas-chip',
  variants: [
    {
      name: 'Filter — selected / unselected',
      html: `
        <atlas-stack direction="row" gap="sm" wrap>
          <atlas-chip variant="filter" name="filter-react"  value="react">React</atlas-chip>
          <atlas-chip variant="filter" name="filter-vue"    value="vue" selected>Vue</atlas-chip>
          <atlas-chip variant="filter" name="filter-svelte" value="svelte">Svelte</atlas-chip>
          <atlas-chip variant="filter" name="filter-disabled" value="solid" disabled>Solid (disabled)</atlas-chip>
        </atlas-stack>
      `,
    },
    {
      name: 'Choice',
      html: `
        <atlas-stack direction="row" gap="sm" wrap>
          <atlas-chip variant="choice" name="choice-low"    value="low">Low</atlas-chip>
          <atlas-chip variant="choice" name="choice-medium" value="medium" selected>Medium</atlas-chip>
          <atlas-chip variant="choice" name="choice-high"   value="high">High</atlas-chip>
        </atlas-stack>
      `,
    },
    {
      name: 'Input — removable',
      html: `
        <atlas-stack direction="row" gap="sm" wrap>
          <atlas-chip variant="input" name="input-bug"  value="bug" removable>bug</atlas-chip>
          <atlas-chip variant="input" name="input-help" value="help-wanted" removable>help-wanted</atlas-chip>
          <atlas-chip variant="input" name="input-good" value="good-first-issue" removable>good-first-issue</atlas-chip>
        </atlas-stack>
      `,
    },
  ],
});

S({
  id: 'chip-group',
  name: 'Chip Group',
  tag: 'atlas-chip-group',
  variants: [
    {
      name: 'Single-select',
      html: `
        <atlas-chip-group selection="single" name="prio" aria-label="Priority">
          <atlas-chip variant="choice" name="prio-low"    value="low">Low</atlas-chip>
          <atlas-chip variant="choice" name="prio-medium" value="medium" selected>Medium</atlas-chip>
          <atlas-chip variant="choice" name="prio-high"   value="high">High</atlas-chip>
        </atlas-chip-group>
      `,
    },
    {
      name: 'Multi-select',
      html: `
        <atlas-chip-group selection="multiple" name="frameworks" aria-label="Frameworks">
          <atlas-chip variant="filter" name="fw-react"  value="react"  selected>React</atlas-chip>
          <atlas-chip variant="filter" name="fw-vue"    value="vue">Vue</atlas-chip>
          <atlas-chip variant="filter" name="fw-svelte" value="svelte" selected>Svelte</atlas-chip>
          <atlas-chip variant="filter" name="fw-solid"  value="solid">Solid</atlas-chip>
          <atlas-chip variant="filter" name="fw-qwik"   value="qwik">Qwik</atlas-chip>
        </atlas-chip-group>
      `,
    },
    {
      name: 'With disabled chips',
      html: `
        <atlas-chip-group selection="multiple" name="plans" aria-label="Plans">
          <atlas-chip variant="filter" name="plan-free"  value="free" selected>Free</atlas-chip>
          <atlas-chip variant="filter" name="plan-pro"   value="pro">Pro</atlas-chip>
          <atlas-chip variant="filter" name="plan-team"  value="team" disabled>Team</atlas-chip>
          <atlas-chip variant="filter" name="plan-ent"   value="enterprise" disabled>Enterprise</atlas-chip>
        </atlas-chip-group>
      `,
    },
  ],
});

interface ChipInputCfg {
  attrs?: Record<string, string | number | boolean>;
  values?: string[];
}

S({
  id: 'chip-input',
  name: 'Chip Input',
  tag: 'atlas-chip-input',
  mount: (demoEl, { config, onLog }) => {
    const cfg = config as ChipInputCfg;
    const el = document.createElement('atlas-chip-input') as HTMLElement & {
      values: string[];
    };
    for (const [k, v] of Object.entries(cfg.attrs ?? {})) {
      if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, String(v));
    }
    if (Array.isArray(cfg.values)) el.values = cfg.values;
    el.style.maxWidth = '480px';
    el.addEventListener('change', (ev) => {
      onLog('change', (ev as CustomEvent).detail);
    });
    demoEl.appendChild(el);
    return () => el.remove();
  },
  configVariants: [
    {
      name: 'Default',
      config: {
        attrs: { name: 'tags', label: 'Tags', placeholder: 'Type a tag and press Enter' },
      },
    },
    {
      name: 'Duplicates blocked',
      config: {
        attrs: {
          name: 'labels',
          label: 'Labels (no duplicates)',
          placeholder: 'Try entering the same label twice',
          duplicates: 'block',
        },
        values: ['bug'],
      },
    },
    {
      name: 'Max=3 (limit reached)',
      config: {
        attrs: { name: 'topics', label: 'Topics (max 3)', placeholder: 'Up to 3', max: '3' },
        values: ['alpha', 'beta', 'gamma'],
      },
    },
    {
      name: 'Validate regex (lowercase alnum only)',
      config: {
        attrs: {
          name: 'slugs',
          label: 'Slugs (lowercase letters/numbers only)',
          placeholder: 'lowercase letters or digits',
          validate: '^[a-z0-9]+$',
        },
      },
    },
    {
      name: 'Disabled',
      config: {
        attrs: { name: 'locked', label: 'Locked field', disabled: true },
        values: ['readonly-a', 'readonly-b'],
      },
    },
  ],
});
