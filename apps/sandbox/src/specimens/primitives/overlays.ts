import { S } from '../_register.ts';
import { AtlasToastProvider } from '@atlas/design/atlas-toast.ts';
import { customDetail, isElement, isHtmlElement, isIdDetail, must } from '../../internal/assert.ts';
S({
    id: 'tooltip',
    name: 'Tooltip',
    tag: 'atlas-tooltip',
    variants: [
        {
            name: 'Placements',
            html: `
        <atlas-stack direction="row" gap="xl" align="center" justify="center" style="padding: 60px">
          <atlas-tooltip label="Tooltip on top" placement="top">
            <atlas-button variant="secondary">Top</atlas-button>
          </atlas-tooltip>
          <atlas-tooltip label="Tooltip on bottom" placement="bottom">
            <atlas-button variant="secondary">Bottom</atlas-button>
          </atlas-tooltip>
          <atlas-tooltip label="Tooltip on left" placement="left">
            <atlas-button variant="secondary">Left</atlas-button>
          </atlas-tooltip>
          <atlas-tooltip label="Tooltip on right" placement="right">
            <atlas-button variant="secondary">Right</atlas-button>
          </atlas-tooltip>
        </atlas-stack>
      `,
        },
        {
            name: 'On icons + pinned open',
            html: `
        <atlas-stack direction="row" gap="lg" align="center">
          <atlas-tooltip label="Open the command palette (⌘K)">
            <atlas-icon name="search" size="lg"></atlas-icon>
          </atlas-tooltip>
          <atlas-tooltip label="This one is pinned open" open>
            <atlas-button size="sm">Hover target</atlas-button>
          </atlas-tooltip>
        </atlas-stack>
      `,
        },
    ],
});
/**
 * `close` events from `atlas-dialog` / `atlas-drawer` carry a free-form
 * `detail` (often `{ returnValue?: string }`). Pass through whatever
 * shape was emitted — the specimen logs it as-is.
 */
function readCloseDetail(ev: Event): unknown {
    return ev instanceof CustomEvent ? (ev.detail ?? {}) : {};
}
S({
    id: 'dialog',
    name: 'Dialog',
    tag: 'atlas-dialog',
    mount: function (demoEl, { onLog }) {
        const btn = document.createElement('atlas-button');
        btn.textContent = 'Open dialog';
        const dialog = document.createElement('atlas-dialog');
        dialog.setAttribute('heading', 'Delete this project?');
        dialog.innerHTML = `
      <atlas-stack gap="sm">
        <atlas-text>
          This will permanently delete the project and all its pages. This action cannot be undone.
        </atlas-text>
        <atlas-alert tone="warning">
          Any scheduled publishes will be cancelled immediately.
        </atlas-alert>
      </atlas-stack>
      <atlas-stack slot="actions" direction="row" gap="sm">
        <atlas-button variant="secondary" data-dialog-cancel>Cancel</atlas-button>
        <atlas-button data-dialog-confirm>Delete</atlas-button>
      </atlas-stack>
    `;
        demoEl.appendChild(btn);
        demoEl.appendChild(dialog);
        btn.addEventListener('click', function () {
            return dialog.open();
        });
        dialog.addEventListener('close', function (ev) {
            return onLog('close', readCloseDetail(ev));
        });
        demoEl.addEventListener('click', function (ev) {
            const t = ev.target;
            if (!isElement(t))
                return;
            if (t.closest('[data-dialog-cancel]'))
                dialog.close('cancel');
            if (t.closest('[data-dialog-confirm]'))
                dialog.close('confirm');
        });
        return function () {
            btn.remove();
            dialog.remove();
        };
    },
    configVariants: [{ name: 'default', config: {} }],
});
S({
    id: 'drawer',
    name: 'Drawer',
    tag: 'atlas-drawer',
    mount: function (demoEl, { onLog }) {
        function makeDrawer(side: string): {
            trigger: HTMLElement;
            drawer: HTMLElement;
        } {
            const trigger = document.createElement('atlas-button');
            trigger.setAttribute('variant', 'secondary');
            trigger.setAttribute('size', 'sm');
            trigger.textContent = `Open ${side}`;
            const drawer = document.createElement('atlas-drawer');
            drawer.setAttribute('side', side);
            // `side` originates from a fixed string-literal list below; the
            // first char is always defined.
            const initial = must(side[0], 'drawer specimen: side is a non-empty string').toUpperCase();
            drawer.setAttribute('heading', `${initial}${side.slice(1)} drawer`);
            drawer.innerHTML = `
        <atlas-stack gap="sm">
          <atlas-text>
            Drawers slide in from the edge. Focus is trapped; Esc closes. Backdrop click closes unless <atlas-code>dismissible="false"</atlas-code>.
          </atlas-text>
          <atlas-label>Filters</atlas-label>
          <atlas-stack gap="xs">
            <atlas-checkbox label="Published"></atlas-checkbox>
            <atlas-checkbox label="Draft"></atlas-checkbox>
            <atlas-checkbox label="Archived"></atlas-checkbox>
          </atlas-stack>
        </atlas-stack>
        <atlas-stack slot="actions" direction="row" gap="sm">
          <atlas-button variant="secondary" data-drawer-cancel>Cancel</atlas-button>
          <atlas-button data-drawer-apply>Apply</atlas-button>
        </atlas-stack>
      `;
            trigger.addEventListener('click', function () {
                return drawer.open();
            });
            drawer.addEventListener('click', function (ev) {
                const t = ev.target;
                if (!isElement(t))
                    return;
                if (t.closest('[data-drawer-cancel]'))
                    drawer.close('cancel');
                if (t.closest('[data-drawer-apply]'))
                    drawer.close('apply');
            });
            drawer.addEventListener('close', function (ev) {
                return onLog(`${side}.close`, readCloseDetail(ev));
            });
            return { trigger, drawer };
        }
        const row = document.createElement('atlas-stack');
        row.setAttribute('direction', 'row');
        row.setAttribute('gap', 'sm');
        row.setAttribute('wrap', '');
        for (const side of ['start', 'end', 'top', 'bottom']) {
            const { trigger, drawer } = makeDrawer(side);
            row.appendChild(trigger);
            demoEl.appendChild(drawer);
        }
        demoEl.appendChild(row);
        return function () {
            demoEl.innerHTML = '';
        };
    },
    configVariants: [{ name: 'default', config: {} }],
});
type ToastTone = 'info' | 'success' | 'warning' | 'danger';
const TOAST_TONES: readonly ToastTone[] = ['info', 'success', 'warning', 'danger'];
function isToastTone(v: unknown): v is ToastTone {
    return typeof v === 'string' && (TOAST_TONES as readonly string[]).includes(v);
}
S({
    id: 'toast',
    name: 'Toast',
    tag: 'atlas-toast',
    mount: function (demoEl, { onLog }) {
        // Provider needs a body-level mount; attach once if not already.
        // `document.querySelector` returns the typed element via the
        // `HTMLElementTagNameMap` augmentation, so no cast required.
        // `AtlasToastProvider.show` auto-installs a provider on `<body>` if
        // none exists; we still ensure one is mounted up-front so the
        // specimen's behaviour matches a real app.
        if (!document.querySelector('atlas-toast-provider')) {
            document.body.appendChild(document.createElement('atlas-toast-provider'));
        }
        function fire(opts: {
            tone: ToastTone;
            message: string;
            heading?: string;
        }): void {
            AtlasToastProvider.show({
                ...opts,
                duration: 4000,
            });
            onLog('spawn', opts);
        }
        const row = document.createElement('atlas-stack');
        row.setAttribute('direction', 'row');
        row.setAttribute('gap', 'sm');
        row.setAttribute('wrap', '');
        row.innerHTML = `
      <atlas-button data-tone="info" variant="secondary" size="sm">Info toast</atlas-button>
      <atlas-button data-tone="success" size="sm">Success toast</atlas-button>
      <atlas-button data-tone="warning" variant="secondary" size="sm">Warning toast</atlas-button>
      <atlas-button data-tone="danger" variant="secondary" size="sm">Danger toast</atlas-button>
      <atlas-button data-action="pin" variant="secondary" size="sm">Pinned (duration=0)</atlas-button>
      <atlas-button data-action="with-action" variant="secondary" size="sm">With action</atlas-button>
    `;
        row.addEventListener('click', function (ev) {
            const target = ev.target;
            if (!isElement(target))
                return;
            const btnEl = target.closest('atlas-button');
            if (!isHtmlElement(btnEl))
                return;
            const toneAttr: unknown = btnEl.dataset['tone'];
            if (isToastTone(toneAttr)) {
                fire({ tone: toneAttr, heading: `${toneAttr} heading`, message: `This is an example ${toneAttr} toast.` });
                return;
            }
            const action = btnEl.dataset['action'];
            if (action === 'pin') {
                AtlasToastProvider.show({ tone: 'info', message: 'Pinned — dismiss manually.', duration: 0 });
            }
            else if (action === 'with-action') {
                AtlasToastProvider.show({
                    tone: 'success',
                    message: 'Saved to drafts.',
                    action: { label: 'Undo', onClick: function () {
                            return onLog('undo', {});
                        } },
                });
            }
        });
        demoEl.appendChild(row);
        return function () {
            return row.remove();
        };
    },
    configVariants: [{ name: 'default', config: {} }],
});
S({
    id: 'command-palette',
    name: 'CommandPalette',
    tag: 'atlas-command-palette',
    mount: function (demoEl, { onLog }) {
        const trigger = document.createElement('atlas-button');
        trigger.innerHTML = 'Open palette &nbsp; <atlas-kbd size="xs">⌘</atlas-kbd> <atlas-kbd size="xs">K</atlas-kbd>';
        const palette = document.createElement('atlas-command-palette');
        palette.items = [
            { id: 'go.pages', label: 'Go to Pages', hint: 'g p', group: 'Navigate', keywords: ['nav', 'content'] },
            { id: 'go.badges', label: 'Go to Badges', hint: 'g b', group: 'Navigate' },
            { id: 'go.points', label: 'Go to Points', hint: 'g s', group: 'Navigate' },
            { id: 'go.settings', label: 'Go to Settings', hint: 'g ,', group: 'Navigate' },
            { id: 'new.page', label: 'New page', hint: 'n p', group: 'Create', keywords: ['add', 'create'] },
            { id: 'new.layout', label: 'New layout', hint: 'n l', group: 'Create' },
            { id: 'new.badge', label: 'New badge', hint: 'n b', group: 'Create' },
            { id: 'theme.toggle', label: 'Toggle theme', hint: '⌘ ⇧ L', group: 'Preferences' },
            { id: 'logout', label: 'Sign out', hint: '', group: 'Account' },
        ];
        trigger.addEventListener('click', function () {
            return palette.open();
        });
        palette.addEventListener('select', function (ev) {
            onLog('select', customDetail(ev, isIdDetail, 'atlas-command-palette.select'));
        });
        // Keyboard shortcut scoped to the demo container so it doesn't
        // hijack the whole sandbox.
        const onKey = function (e: KeyboardEvent): void {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                palette.open();
            }
        };
        demoEl.addEventListener('keydown', onKey);
        const note = document.createElement('atlas-text');
        note.setAttribute('variant', 'muted');
        note.innerHTML = 'Click the button or focus this panel and press <atlas-kbd size="xs">⌘</atlas-kbd> <atlas-kbd size="xs">K</atlas-kbd>.';
        const stack = document.createElement('atlas-stack');
        stack.setAttribute('gap', 'md');
        stack.appendChild(trigger);
        stack.appendChild(note);
        demoEl.appendChild(stack);
        demoEl.appendChild(palette);
        // Make the container focusable so the Cmd+K handler actually fires.
        demoEl.setAttribute('tabindex', '0');
        return function () {
            demoEl.removeEventListener('keydown', onKey);
            stack.remove();
            palette.remove();
            demoEl.removeAttribute('tabindex');
        };
    },
    configVariants: [{ name: 'default', config: {} }],
});
