import { S } from '../_register.ts';

S({
  id: 'menu',
  name: 'Menu',
  tag: 'atlas-menu',
  mount: (demoEl, { onLog }) => {
    // ── Variant 1: dropdown anchored to a trigger button ────────────
    const dropdownWrap = document.createElement('atlas-stack');
    dropdownWrap.setAttribute('gap', 'sm');
    dropdownWrap.innerHTML = `
      <atlas-text variant="muted">Click the button to open a dropdown.</atlas-text>
      <atlas-stack direction="row" gap="md" align="center">
        <atlas-button id="popups-menu-trigger-1">Actions</atlas-button>
        <atlas-menu placement="bottom" data-menu="dropdown">
          <atlas-menu-item value="rename">Rename</atlas-menu-item>
          <atlas-menu-item value="duplicate" shortcut="⌘D">Duplicate</atlas-menu-item>
          <atlas-menu-separator></atlas-menu-separator>
          <atlas-menu-item value="archive" disabled>Archive</atlas-menu-item>
          <atlas-menu-item value="delete" destructive shortcut="⌫">Delete</atlas-menu-item>
        </atlas-menu>
      </atlas-stack>
    `;

    // ── Variant 2: long-press / right-click context menu ────────────
    const contextWrap = document.createElement('atlas-stack');
    contextWrap.setAttribute('gap', 'sm');
    contextWrap.innerHTML = `
      <atlas-text variant="muted">
        Long-press (touch) or right-click the card to open a context menu.
      </atlas-text>
      <atlas-card id="popups-menu-trigger-2" style="padding: var(--atlas-space-lg); cursor: context-menu;">
        <atlas-stack gap="xs">
          <atlas-heading level="4">project-readme.md</atlas-heading>
          <atlas-text variant="muted">Press and hold to reveal options.</atlas-text>
        </atlas-stack>
      </atlas-card>
      <atlas-menu placement="bottom" long-press anchor="#popups-menu-trigger-2" data-menu="context">
        <atlas-menu-item value="open">Open</atlas-menu-item>
        <atlas-menu-item value="copy" shortcut="⌘C">Copy</atlas-menu-item>
        <atlas-menu-item value="share">Share…</atlas-menu-item>
        <atlas-menu-separator></atlas-menu-separator>
        <atlas-menu-item value="delete" destructive>Delete</atlas-menu-item>
      </atlas-menu>
    `;

    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'xl');
    stack.appendChild(dropdownWrap);
    stack.appendChild(contextWrap);
    demoEl.appendChild(stack);

    // Wire dropdown after attachment so anchor selector / sibling
    // resolution sees the final DOM tree.
    const dropdownTrigger = stack.querySelector('#popups-menu-trigger-1') as HTMLElement | null;
    const dropdownMenu = stack.querySelector('atlas-menu[data-menu="dropdown"]') as
      | (HTMLElement & { open: (anchor?: HTMLElement) => void })
      | null;
    if (dropdownTrigger && dropdownMenu) {
      dropdownTrigger.addEventListener('click', () => dropdownMenu.open(dropdownTrigger));
    }

    for (const menu of stack.querySelectorAll('atlas-menu')) {
      const which = menu.getAttribute('data-menu') ?? 'menu';
      menu.addEventListener('select', (ev) => {
        const detail = (ev as CustomEvent<{ value: string }>).detail;
        onLog(`${which}.select`, detail);
      });
      menu.addEventListener('open', () => onLog(`${which}.open`, {}));
      menu.addEventListener('close', () => onLog(`${which}.close`, {}));
    }

    return () => {
      stack.remove();
    };
  },
  configVariants: [{ name: 'default', config: {} }],
});

S({
  id: 'popover',
  name: 'Popover',
  tag: 'atlas-popover',
  mount: (demoEl, { onLog }) => {
    const wrap = document.createElement('atlas-stack');
    wrap.setAttribute('gap', 'xl');
    wrap.innerHTML = `
      <atlas-stack gap="sm">
        <atlas-heading level="4">Triggers</atlas-heading>
        <atlas-stack direction="row" gap="lg" align="center" wrap>
          <atlas-popover trigger="hover" data-pop="hover">
            <atlas-button slot="anchor" variant="secondary">Hover me</atlas-button>
            <atlas-stack gap="xs">
              <atlas-heading level="5">Hover popover</atlas-heading>
              <atlas-text>Opens on hover or focus, dismisses on leave.</atlas-text>
            </atlas-stack>
          </atlas-popover>
          <atlas-popover trigger="click" data-pop="click">
            <atlas-button slot="anchor">Click me</atlas-button>
            <atlas-stack gap="xs">
              <atlas-heading level="5">Click popover</atlas-heading>
              <atlas-text>Toggles on click. Click outside or press Esc to dismiss.</atlas-text>
            </atlas-stack>
          </atlas-popover>
        </atlas-stack>
      </atlas-stack>

      <atlas-stack gap="sm">
        <atlas-heading level="4">Placements</atlas-heading>
        <atlas-stack direction="row" gap="lg" align="center" justify="center" wrap style="padding: 60px;">
          <atlas-popover placement="top" data-pop="top">
            <atlas-button slot="anchor" variant="secondary" size="sm">Top</atlas-button>
            <atlas-text>Anchored above the trigger.</atlas-text>
          </atlas-popover>
          <atlas-popover placement="bottom" data-pop="bottom">
            <atlas-button slot="anchor" variant="secondary" size="sm">Bottom</atlas-button>
            <atlas-text>Anchored below the trigger.</atlas-text>
          </atlas-popover>
          <atlas-popover placement="start" data-pop="start">
            <atlas-button slot="anchor" variant="secondary" size="sm">Start</atlas-button>
            <atlas-text>Anchored to the inline-start edge.</atlas-text>
          </atlas-popover>
          <atlas-popover placement="end" data-pop="end">
            <atlas-button slot="anchor" variant="secondary" size="sm">End</atlas-button>
            <atlas-text>Anchored to the inline-end edge.</atlas-text>
          </atlas-popover>
        </atlas-stack>
      </atlas-stack>

      <atlas-stack gap="sm">
        <atlas-heading level="4">Rich content</atlas-heading>
        <atlas-popover placement="bottom" data-pop="form">
          <atlas-button slot="anchor">Quick filter</atlas-button>
          <atlas-stack gap="sm" style="min-width: 240px;">
            <atlas-heading level="5">Filter pages</atlas-heading>
            <atlas-input label="Search" placeholder="Type a query"></atlas-input>
            <atlas-stack gap="xs">
              <atlas-checkbox label="Published"></atlas-checkbox>
              <atlas-checkbox label="Draft"></atlas-checkbox>
              <atlas-checkbox label="Archived"></atlas-checkbox>
            </atlas-stack>
            <atlas-stack direction="row" gap="sm" justify="end">
              <atlas-button variant="secondary" size="sm" data-pop-cancel>Cancel</atlas-button>
              <atlas-button size="sm" data-pop-apply>Apply</atlas-button>
            </atlas-stack>
          </atlas-stack>
        </atlas-popover>
      </atlas-stack>
    `;
    demoEl.appendChild(wrap);

    for (const pop of wrap.querySelectorAll('atlas-popover')) {
      const which = pop.getAttribute('data-pop') ?? 'popover';
      pop.addEventListener('open', () => onLog(`${which}.open`, {}));
      pop.addEventListener('close', () => onLog(`${which}.close`, {}));
    }
    // Wire the cancel/apply buttons inside the rich-content popover so
    // the demo logs intent without leaving the popover open.
    wrap.addEventListener('click', (ev) => {
      const target = ev.target as Element | null;
      const apply = target?.closest('[data-pop-apply]');
      const cancel = target?.closest('[data-pop-cancel]');
      if (!apply && !cancel) return;
      const pop = (target as Element).closest('atlas-popover[data-pop="form"]') as
        | (HTMLElement & { close: () => void })
        | null;
      onLog(apply ? 'form.apply' : 'form.cancel', {});
      pop?.close();
    });

    return () => {
      wrap.remove();
    };
  },
  configVariants: [{ name: 'default', config: {} }],
});
