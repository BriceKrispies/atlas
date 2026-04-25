import { S } from '../_register.ts';

S({
  id: 'bottom-sheet',
  name: 'BottomSheet',
  tag: 'atlas-bottom-sheet',
  mount: (demoEl, { onLog }) => {
    function makeSheet(opts: {
      label: string;
      heading: string;
      snapPoints?: string;
      dismissible?: string;
    }): { trigger: HTMLElement; sheet: HTMLElement } {
      const trigger = document.createElement('atlas-button') as HTMLElement;
      trigger.setAttribute('variant', 'secondary');
      trigger.setAttribute('size', 'sm');
      trigger.textContent = opts.label;

      const sheet = document.createElement('atlas-bottom-sheet') as HTMLElement & {
        open: () => void;
        close: (v?: string) => void;
      };
      sheet.setAttribute('heading', opts.heading);
      if (opts.snapPoints) sheet.setAttribute('snap-points', opts.snapPoints);
      if (opts.dismissible) sheet.setAttribute('dismissible', opts.dismissible);
      sheet.innerHTML = `
        <atlas-stack gap="sm">
          <atlas-text>
            Sheets pin to the bottom edge on phones and centre as bottom-aligned cards on wider viewports. Drag the grip down to dismiss.
          </atlas-text>
          <atlas-stack gap="xs">
            <atlas-checkbox label="Notify the team"></atlas-checkbox>
            <atlas-checkbox label="Pin to channel"></atlas-checkbox>
            <atlas-checkbox label="Save draft"></atlas-checkbox>
          </atlas-stack>
        </atlas-stack>
        <atlas-stack slot="actions" direction="row" gap="sm">
          <atlas-button variant="secondary" data-sheet-cancel>Cancel</atlas-button>
          <atlas-button data-sheet-confirm>Save</atlas-button>
        </atlas-stack>
      `;
      trigger.addEventListener('click', () => sheet.open());
      sheet.addEventListener('click', (ev) => {
        const t = ev.target as Element | null;
        if (t?.closest('[data-sheet-cancel]')) sheet.close('cancel');
        if (t?.closest('[data-sheet-confirm]')) sheet.close('confirm');
      });
      sheet.addEventListener('open', () => onLog(`${opts.label}.open`, {}));
      sheet.addEventListener('close', (ev) =>
        onLog(`${opts.label}.close`, (ev as CustomEvent).detail ?? {}),
      );
      return { trigger, sheet };
    }

    const row = document.createElement('atlas-stack');
    row.setAttribute('direction', 'row');
    row.setAttribute('gap', 'sm');
    row.setAttribute('wrap', '');

    const peek = makeSheet({
      label: 'Peek',
      heading: 'Filter results',
      snapPoints: '0.3,0.6,1',
    });
    const full = makeSheet({
      label: 'Full',
      heading: 'Compose post',
    });
    const sticky = makeSheet({
      label: 'Sticky',
      heading: 'Required action',
      dismissible: 'false',
    });

    row.appendChild(peek.trigger);
    row.appendChild(full.trigger);
    row.appendChild(sticky.trigger);
    demoEl.appendChild(peek.sheet);
    demoEl.appendChild(full.sheet);
    demoEl.appendChild(sticky.sheet);
    demoEl.appendChild(row);
    return () => {
      demoEl.innerHTML = '';
    };
  },
  configVariants: [{ name: 'default', config: {} }],
});

S({
  id: 'action-sheet',
  name: 'ActionSheet',
  tag: 'atlas-action-sheet',
  mount: (demoEl, { onLog }) => {
    function makeSheet(opts: {
      label: string;
      heading: string;
      description?: string;
      items: Array<{ value: string; label: string; variant?: string }>;
      cancel?: { value: string; label: string };
    }): { trigger: HTMLElement; sheet: HTMLElement } {
      const trigger = document.createElement('atlas-button') as HTMLElement;
      trigger.setAttribute('variant', 'secondary');
      trigger.setAttribute('size', 'sm');
      trigger.textContent = opts.label;

      const sheet = document.createElement('atlas-action-sheet') as HTMLElement & {
        open: () => void;
        close: (v?: string) => void;
      };
      sheet.setAttribute('heading', opts.heading);
      if (opts.description) sheet.setAttribute('description', opts.description);

      for (const item of opts.items) {
        const row = document.createElement('atlas-action-sheet-item');
        row.setAttribute('value', item.value);
        if (item.variant) row.setAttribute('variant', item.variant);
        row.textContent = item.label;
        sheet.appendChild(row);
      }
      if (opts.cancel) {
        const c = document.createElement('atlas-action-sheet-item');
        c.setAttribute('value', opts.cancel.value);
        c.setAttribute('slot', 'cancel');
        c.setAttribute('cancel', '');
        c.textContent = opts.cancel.label;
        sheet.appendChild(c);
      }

      trigger.addEventListener('click', () => sheet.open());
      sheet.addEventListener('action', (ev) => {
        const detail = (ev as CustomEvent<{ value: string }>).detail;
        onLog(`${opts.label}.action`, detail);
      });
      sheet.addEventListener('close', () => onLog(`${opts.label}.close`, {}));
      return { trigger, sheet };
    }

    const row = document.createElement('atlas-stack');
    row.setAttribute('direction', 'row');
    row.setAttribute('gap', 'sm');
    row.setAttribute('wrap', '');

    const destructive = makeSheet({
      label: 'Destructive',
      heading: 'Delete this conversation?',
      description: 'This action cannot be undone.',
      items: [
        { value: 'archive', label: 'Archive instead' },
        { value: 'delete', label: 'Delete', variant: 'destructive' },
      ],
      cancel: { value: 'cancel', label: 'Cancel' },
    });
    const moveSheet = makeSheet({
      label: 'Choose action',
      heading: 'Move file',
      items: [
        { value: 'copy', label: 'Copy to folder' },
        { value: 'move', label: 'Move to folder', variant: 'primary' },
        { value: 'duplicate', label: 'Duplicate' },
      ],
      cancel: { value: 'cancel', label: 'Cancel' },
    });
    const noCancel = makeSheet({
      label: 'No cancel',
      heading: 'Sort by',
      items: [
        { value: 'recent', label: 'Most recent' },
        { value: 'oldest', label: 'Oldest first' },
        { value: 'alpha', label: 'Alphabetical' },
      ],
    });

    row.appendChild(destructive.trigger);
    row.appendChild(moveSheet.trigger);
    row.appendChild(noCancel.trigger);
    demoEl.appendChild(destructive.sheet);
    demoEl.appendChild(moveSheet.sheet);
    demoEl.appendChild(noCancel.sheet);
    demoEl.appendChild(row);
    return () => {
      demoEl.innerHTML = '';
    };
  },
  configVariants: [{ name: 'default', config: {} }],
});

S({
  id: 'fab',
  name: 'Fab',
  tag: 'atlas-fab',
  mount: (demoEl, { onLog }) => {
    // FABs render `position: fixed`. To keep the sandbox preview
    // self-contained we wrap them in a relatively-positioned stage so
    // they anchor to the demo box rather than the page.
    const stage = document.createElement('div');
    stage.style.position = 'relative';
    stage.style.height = '320px';
    stage.style.border = '1px dashed var(--atlas-color-border, #d4d7dc)';
    stage.style.borderRadius = '6px';
    stage.style.background = 'var(--atlas-color-surface, #f6f7f9)';
    stage.style.padding = 'var(--atlas-space-md, 12px)';
    stage.style.overflow = 'hidden';

    const note = document.createElement('atlas-text');
    note.setAttribute('variant', 'muted');
    note.setAttribute('block', '');
    note.textContent = 'Each FAB is anchored to its corner of this stage.';
    stage.appendChild(note);

    function makeFab(attrs: Record<string, string>, iconName = 'add'): HTMLElement {
      const fab = document.createElement('atlas-fab') as HTMLElement;
      for (const [k, v] of Object.entries(attrs)) fab.setAttribute(k, v);
      // Force the fixed FAB to anchor to the stage instead of the
      // viewport by overriding `position: absolute` from outside.
      fab.style.position = 'absolute';
      const icon = document.createElement('atlas-icon');
      icon.setAttribute('name', iconName);
      fab.appendChild(icon);
      fab.addEventListener('click', () =>
        onLog('click', { position: attrs['position'] ?? 'bottom-right', label: attrs['label'] ?? '' }),
      );
      return fab;
    }

    stage.appendChild(makeFab({ position: 'bottom-right', 'aria-label': 'Search' }, 'search'));
    stage.appendChild(makeFab({ position: 'bottom-left', 'aria-label': 'Menu' }, 'menu'));
    stage.appendChild(makeFab({ position: 'bottom-center', label: 'Upload', extended: '' }, 'upload'));

    demoEl.appendChild(stage);
    return () => stage.remove();
  },
  configVariants: [{ name: 'default', config: {} }],
});
