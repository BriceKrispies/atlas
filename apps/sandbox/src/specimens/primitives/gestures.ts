import { S } from '../_register.ts';

interface PullToRefreshConfig {
  disabled?: boolean;
}

S({
  id: 'pull-to-refresh',
  name: 'PullToRefresh',
  tag: 'atlas-pull-to-refresh',
  mount: (demoEl, { config, onLog }) => {
    const cfg = (config ?? {}) as PullToRefreshConfig;

    const wrapper = document.createElement('atlas-box');
    wrapper.setAttribute('border', '');
    wrapper.setAttribute('rounded', 'md');
    wrapper.style.height = '320px';
    wrapper.style.overflow = 'hidden';
    wrapper.style.display = 'block';

    const ptr = document.createElement('atlas-pull-to-refresh') as HTMLElement & {
      busy: boolean;
    };
    ptr.setAttribute('threshold', '64');
    if (cfg.disabled) ptr.setAttribute('disabled', '');
    ptr.style.height = '100%';
    ptr.style.display = 'block';

    // Optional desktop fallback button — slotted under [slot="refresh-button"].
    const refreshBtn = document.createElement('atlas-button');
    refreshBtn.setAttribute('slot', 'refresh-button');
    refreshBtn.setAttribute('size', 'sm');
    refreshBtn.setAttribute('variant', 'ghost');
    refreshBtn.setAttribute('aria-label', 'Refresh feed');
    refreshBtn.textContent = 'Refresh';
    ptr.appendChild(refreshBtn);

    // The scrolling content lives in the default slot.
    const list = document.createElement('atlas-stack');
    list.setAttribute('gap', 'sm');
    list.setAttribute('padding', 'md');
    let counter = 0;
    function renderItems(): void {
      const rows: string[] = [];
      for (let i = 0; i < 12; i++) {
        rows.push(
          `<atlas-card padding="sm"><atlas-stack gap="xs">` +
          `<atlas-text variant="medium">Feed item ${i + 1 + counter * 12}</atlas-text>` +
          `<atlas-text variant="muted">Pull down at the top to refresh — release past the threshold.</atlas-text>` +
          `</atlas-stack></atlas-card>`,
        );
      }
      list.innerHTML = rows.join('');
    }
    renderItems();
    ptr.appendChild(list);

    // Mock refresh — resolves after 800ms with a "success" log.
    ptr.addEventListener('refresh', () => {
      if (ptr.busy) return;
      onLog('refresh', { status: 'started' });
      ptr.setAttribute('busy', '');
      window.setTimeout(() => {
        counter += 1;
        renderItems();
        ptr.removeAttribute('busy');
        onLog('refresh', { status: 'success', batch: counter });
      }, 800);
    });

    wrapper.appendChild(ptr);
    demoEl.appendChild(wrapper);

    return () => {
      wrapper.remove();
    };
  },
  configVariants: [
    { name: 'default', config: {} },
    { name: 'disabled', config: { disabled: true } },
  ],
});

interface SwipeActionsConfig {
  withLeading?: boolean;
  keyboardOnly?: boolean;
}

S({
  id: 'swipe-actions',
  name: 'SwipeActions',
  tag: 'atlas-swipe-actions',
  mount: (demoEl, { config, onLog }) => {
    const cfg = (config ?? {}) as SwipeActionsConfig;

    const stack = document.createElement('atlas-stack');
    stack.setAttribute('gap', 'sm');
    stack.style.maxWidth = '520px';

    if (cfg.keyboardOnly) {
      const note = document.createElement('atlas-alert');
      note.setAttribute('tone', 'info');
      note.innerHTML =
        `<atlas-text slot="heading">Keyboard-only fallback</atlas-text>` +
        `<atlas-text>Tab into the row — actions are real focusable buttons. ` +
        `When an action receives focus the row auto-opens to that side. ` +
        `Press Escape to close.</atlas-text>`;
      stack.appendChild(note);
    }

    const messages = [
      { from: 'Ada Lovelace',  preview: 'Re: analytical engine notes' },
      { from: 'Grace Hopper',   preview: 'Compiler bug — see attached log' },
      { from: 'Alan Turing',    preview: 'Lunch tomorrow?' },
    ];

    for (const msg of messages) {
      const row = document.createElement('atlas-swipe-actions') as HTMLElement & {
        open: (s: 'leading' | 'trailing', f?: boolean) => void;
        close: () => void;
      };
      row.setAttribute('name', `row-${msg.from.toLowerCase().replace(/\s+/g, '-')}`);
      row.style.borderBottom = '1px solid var(--atlas-color-border)';

      // Leading actions — only when configured.
      if (cfg.withLeading) {
        const archiveLead = document.createElement('atlas-button');
        archiveLead.setAttribute('slot', 'leading-actions');
        archiveLead.setAttribute('variant', 'primary');
        archiveLead.setAttribute('aria-label', `Mark ${msg.from} as read`);
        archiveLead.textContent = 'Read';
        row.appendChild(archiveLead);
      }

      // Default content — the row body.
      const body = document.createElement('atlas-box');
      body.setAttribute('padding', 'sm');
      body.innerHTML =
        `<atlas-stack gap="xs">` +
        `<atlas-text variant="medium">${escapeText(msg.from)}</atlas-text>` +
        `<atlas-text variant="muted">${escapeText(msg.preview)}</atlas-text>` +
        `</atlas-stack>`;
      row.appendChild(body);

      // Trailing actions — archive + delete.
      const archive = document.createElement('atlas-button');
      archive.setAttribute('slot', 'trailing-actions');
      archive.setAttribute('variant', 'secondary');
      archive.setAttribute('aria-label', `Archive ${msg.from}`);
      archive.textContent = 'Archive';
      row.appendChild(archive);

      const del = document.createElement('atlas-button');
      del.setAttribute('slot', 'trailing-actions');
      del.setAttribute('variant', 'danger');
      del.setAttribute('aria-label', `Delete message from ${msg.from}`);
      del.textContent = 'Delete';
      row.appendChild(del);

      row.addEventListener('open', (ev) => {
        onLog('open', (ev as CustomEvent).detail);
      });
      row.addEventListener('close', () => {
        onLog('close', { from: msg.from });
      });
      row.addEventListener('action', (ev) => {
        onLog('action', { from: msg.from, ...(ev as CustomEvent).detail });
      });

      stack.appendChild(row);
    }

    demoEl.appendChild(stack);
    return () => stack.remove();
  },
  configVariants: [
    { name: 'trailing-only', config: {} },
    { name: 'with-leading', config: { withLeading: true } },
    { name: 'keyboard-only', config: { keyboardOnly: true } },
  ],
});

/** Local helper — sandbox-only, mirrors design/util escapeText semantics. */
function escapeText(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
