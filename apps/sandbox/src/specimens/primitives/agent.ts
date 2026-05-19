import { S } from '../_register.ts';
import { customDetail, isValueDetail, parseMountConfig, v, } from '../../internal/assert.ts';
/* -------------------- atlas-diff specimens -------------------- */
const SMALL_BEFORE = `function add(a, b) {
  return a + b;
}

function multiply(a, b) {
  return a * b;
}
`;
const SMALL_AFTER = `function add(a, b) {
  // Numeric coercion guard
  return Number(a) + Number(b);
}

function multiply(a, b) {
  return a * b;
}
`;
function buildLargeDiff(): {
    before: string;
    after: string;
} {
    const before: string[] = [];
    const after: string[] = [];
    for (let i = 0; i < 200; i++) {
        if (i % 17 === 0) {
            before.push(`// line ${i} — original`);
            after.push(`// line ${i} — UPDATED`);
        }
        else if (i % 31 === 0) {
            before.push(`removed line ${i}`);
            // skipped → deletion
        }
        else if (i % 41 === 0) {
            // added line on right side
            before.push(`stable line ${i}`);
            after.push(`stable line ${i}`);
            after.push(`new line ${i}.5`);
        }
        else {
            before.push(`stable line ${i}`);
            after.push(`stable line ${i}`);
        }
    }
    return { before: before.join('\n'), after: after.join('\n') };
}
const LARGE = buildLargeDiff();
S({
    id: 'diff',
    name: 'Diff',
    tag: 'atlas-diff',
    mount: function (demoEl, ctx) {
        // Sandbox mount-config arrives as `Record<string, unknown>`. Narrow
        // each known field through `parseMountConfig` — unknown / wrongly-
        // typed fields fall through to the defaults below.
        const cfg = parseMountConfig<{
            size: string;
            view: string;
        }>(ctx.config, {
            size: v.string,
            view: v.string,
        });
        const el = document.createElement('atlas-diff');
        if (cfg.size === 'large') {
            el.setAttribute('before', LARGE.before);
            el.setAttribute('after', LARGE.after);
        }
        else {
            el.setAttribute('before', SMALL_BEFORE);
            el.setAttribute('after', SMALL_AFTER);
        }
        el.setAttribute('view', cfg.view ?? 'unified');
        el.setAttribute('language', 'javascript');
        demoEl.appendChild(el);
        return function () {
            return el.remove();
        };
    },
    configVariants: [
        { name: 'Small · unified', config: { size: 'small', view: 'unified' } },
        { name: 'Small · split', config: { size: 'small', view: 'split' } },
        { name: 'Large · unified', config: { size: 'large', view: 'unified' } },
        { name: 'Large · split', config: { size: 'large', view: 'split' } },
    ],
});
/* -------------------- atlas-json-view specimens -------------------- */
const SIMPLE_OBJECT = {
    surfaceId: 'admin.content.pages-list',
    route: '/content/pages',
    auth: 'required',
    states: ['loading', 'empty', 'success', 'error'],
};
const DEEP_OBJECT = {
    request: {
        method: 'POST',
        path: '/api/v1/intents',
        headers: { 'X-Correlation-Id': '7c0a-ee21-4f', 'Content-Type': 'application/json' },
        body: {
            actionId: 'content.page.create',
            tenantId: 'acme',
            payload: {
                title: 'Welcome',
                slug: 'welcome',
                meta: { description: 'Landing page', tags: ['onboarding', 'marketing'] },
            },
        },
    },
    response: {
        ok: true,
        correlationId: '7c0a-ee21-4f',
        events: [
            { id: 'evt_01', kind: 'page.created' },
            { id: 'evt_02', kind: 'cache.invalidated', tags: ['tenant:acme', 'page:welcome'] },
        ],
    },
};
const LARGE_ARRAY = {
    results: Array.from({ length: 40 }, function (_, i) {
        return ({ id: `item_${i}`, n: i, ok: i % 3 === 0 });
    }),
};
const LONG_STRING_OBJECT = {
    page: 'welcome',
    body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent finibus, magna nec ' +
        'rhoncus accumsan, ipsum nibh laoreet ipsum, vitae lacinia metus eros vel risus. Sed ' +
        'a tristique justo. Curabitur euismod faucibus quam, sit amet posuere risus aliquet ' +
        'nec. Etiam non magna sed lectus mollis aliquet. Donec porttitor, ipsum nec ' +
        'hendrerit ultrices, libero nibh tincidunt felis, sed condimentum dui dui non lectus.',
};
S({
    id: 'json-view',
    name: 'JsonView',
    tag: 'atlas-json-view',
    mount: function (demoEl, ctx) {
        const cfg = parseMountConfig<{
            variant: string;
        }>(ctx.config, {
            variant: v.string,
        });
        const el = document.createElement('atlas-json-view') as HTMLElement & {
            data: unknown;
        };
        if (cfg.variant === 'simple')
            el.data = SIMPLE_OBJECT;
        else if (cfg.variant === 'deep')
            el.data = DEEP_OBJECT;
        else if (cfg.variant === 'large')
            el.data = LARGE_ARRAY;
        else
            el.data = LONG_STRING_OBJECT;
        demoEl.appendChild(el);
        return function () {
            return el.remove();
        };
    },
    configVariants: [
        { name: 'Simple object', config: { variant: 'simple' } },
        { name: 'Deeply nested', config: { variant: 'deep' } },
        { name: 'Large array', config: { variant: 'large' } },
        { name: 'Long strings', config: { variant: 'long' } },
    ],
});
/* -------------------- atlas-activity specimens -------------------- */
type ActivityMode = 'streaming' | 'success' | 'error' | 'cancelable';
function asActivityMode(s: string | undefined): ActivityMode {
    switch (s) {
        case 'success':
        case 'error':
        case 'cancelable':
            return s;
        default:
            return 'streaming';
    }
}
S({
    id: 'activity',
    name: 'Activity',
    tag: 'atlas-activity',
    mount: function (demoEl, { config, onLog }) {
        const cfg = parseMountConfig<{
            mode: string;
        }>(config, { mode: v.string });
        const mode = asActivityMode(cfg.mode);
        const el = document.createElement('atlas-activity') as HTMLElement & {
            cancelable: boolean;
        };
        el.setAttribute('title', titleFor(mode));
        el.setAttribute('started-at', new Date(Date.now() - randomBackoff(mode)).toISOString());
        el.setAttribute('status', initialStatus(mode));
        if (mode === 'cancelable' || mode === 'streaming')
            el.setAttribute('cancelable', '');
        demoEl.appendChild(el);
        el.addEventListener('cancel', function () {
            onLog('cancel', {});
            el.setAttribute('status', 'canceled');
            el.setAttribute('ended-at', new Date().toISOString());
        });
        let logTimer: number | null = null;
        let lineNo = 0;
        if (mode === 'streaming' || mode === 'cancelable') {
            const lines = [
                '→ resolving plan…',
                '→ reading 4 files',
                '→ patch generated (12 +, 3 −)',
                '→ running tests',
                '→ 32 passed in 2.4s',
                '→ committing change',
            ];
            const writeLine = function (): void {
                if (lineNo >= lines.length) {
                    if (mode === 'streaming') {
                        el.setAttribute('status', 'success');
                        el.setAttribute('ended-at', new Date().toISOString());
                    }
                    return;
                }
                const log = document.createElement('atlas-text');
                log.setAttribute('variant', 'mono');
                log.textContent = lines[lineNo] ?? '';
                el.appendChild(log);
                lineNo += 1;
                logTimer = window.setTimeout(writeLine, 800);
            };
            logTimer = window.setTimeout(writeLine, 400);
        }
        else if (mode === 'success') {
            const log = document.createElement('atlas-text');
            log.setAttribute('variant', 'mono');
            log.textContent = '✓ All steps completed in 4.2s';
            el.appendChild(log);
        }
        else if (mode === 'error') {
            const log = document.createElement('atlas-text');
            log.setAttribute('variant', 'mono');
            log.textContent = '✗ Failed in step 3: permission denied (cap=write:content)';
            el.appendChild(log);
        }
        return function () {
            if (logTimer != null)
                window.clearTimeout(logTimer);
            el.remove();
        };
    },
    configVariants: [
        { name: 'Streaming logs (running)', config: { mode: 'streaming' } },
        { name: 'Cancelable run', config: { mode: 'cancelable' } },
        { name: 'Success (final state)', config: { mode: 'success' } },
        { name: 'Error (final state)', config: { mode: 'error' } },
    ],
});
function titleFor(mode: 'streaming' | 'success' | 'error' | 'cancelable'): string {
    if (mode === 'success')
        return 'codegen.apply-patch';
    if (mode === 'error')
        return 'codegen.apply-patch';
    return 'codegen.apply-patch';
}
function initialStatus(mode: 'streaming' | 'success' | 'error' | 'cancelable'): string {
    if (mode === 'success')
        return 'success';
    if (mode === 'error')
        return 'error';
    return 'running';
}
function randomBackoff(mode: string): number {
    if (mode === 'success' || mode === 'error')
        return 4200;
    return 600;
}
/* -------------------- atlas-consent-banner specimens -------------------- */
S({
    id: 'consent-banner',
    name: 'ConsentBanner',
    tag: 'atlas-consent-banner',
    mount: function (demoEl, { config, onLog }) {
        const cfg = parseMountConfig<{
            severity: string;
        }>(config, { severity: v.string });
        const severity = cfg.severity ?? 'info';
        const el = document.createElement('atlas-consent-banner');
        el.setAttribute('severity', severity);
        el.setAttribute('title', titleForSeverity(severity));
        el.innerHTML = `
      <atlas-text>${descriptionForSeverity(severity)}</atlas-text>
      <atlas-stack slot="details" gap="xs">
        <atlas-text variant="small" variant-x="muted">Tool: <atlas-code>backend.write</atlas-code></atlas-text>
        <atlas-text variant="small">Capability scope: <atlas-code>tenant:acme/content/*</atlas-code></atlas-text>
      </atlas-stack>
    `;
        el.addEventListener('approve', function () {
            return onLog('approve', {});
        });
        el.addEventListener('deny', function () {
            return onLog('deny', {});
        });
        demoEl.appendChild(el);
        return function () {
            return el.remove();
        };
    },
    configVariants: [
        { name: 'Info', config: { severity: 'info' } },
        { name: 'Warning', config: { severity: 'warning' } },
        { name: 'Danger', config: { severity: 'danger' } },
    ],
});
function titleForSeverity(s: string): string {
    if (s === 'info')
        return 'Agent wants to read content/pages';
    if (s === 'warning')
        return 'Agent wants to publish a page';
    return 'Agent wants to delete 12 pages';
}
function descriptionForSeverity(s: string): string {
    if (s === 'info')
        return 'The agent will list pages in the <strong>content</strong> module to find candidates for editing.';
    if (s === 'warning')
        return 'Publishing makes the page visible on your public site immediately. This action is reversible.';
    return 'Deleting 12 pages cannot be undone. All revisions and analytics for these pages will be lost.';
}
/* -------------------- atlas-capability-grid specimen -------------------- */
S({
    id: 'capability-grid',
    name: 'CapabilityGrid',
    tag: 'atlas-capability-grid',
    mount: function (demoEl, { onLog }) {
        const grid = document.createElement('atlas-capability-grid');
        grid.setAttribute('columns', 'auto');
        const caps: Array<{
            value: string;
            label: string;
            description: string;
            selected?: boolean;
        }> = [
            { value: 'read.content', label: 'Read content', description: 'List and view pages, sections, layouts.', selected: true },
            { value: 'write.content', label: 'Write content', description: 'Create, edit, and reorder pages.', selected: true },
            { value: 'publish', label: 'Publish', description: 'Make pages visible on your public site.', selected: true },
            { value: 'media.upload', label: 'Upload media', description: 'Add images and files to media library.' },
            { value: 'users.invite', label: 'Invite users', description: 'Send tenant invitations.' },
            { value: 'billing.read', label: 'Read billing', description: 'View invoices and plan usage.' },
        ];
        for (const cap of caps) {
            const tile = document.createElement('atlas-capability-tile');
            tile.setAttribute('value', cap.value);
            tile.setAttribute('label', cap.label);
            tile.setAttribute('description', cap.description);
            if (cap.selected)
                tile.setAttribute('selected', '');
            grid.appendChild(tile);
        }
        grid.addEventListener('change', function (ev) {
            onLog('change', customDetail(ev, isValueArrayDetail, 'atlas-capability-grid.change'));
        });
        demoEl.appendChild(grid);
        return function () {
            return grid.remove();
        };
    },
    configVariants: [{ name: 'default', config: {} }],
});
/** Validator: `{ value: string[] }`. */
function isValueArrayDetail(d: unknown): d is {
    value: string[];
} {
    if (typeof d !== 'object' || d === null)
        return false;
    const val: unknown = (d as {
        value?: unknown;
    }).value;
    return Array.isArray(val) && val.every(function (x) {
        return typeof x === 'string';
    });
}
/** Validator: `{ query: string; type: string }`. */
function isQueryTypeDetail(d: unknown): d is {
    query: string;
    type: string;
} {
    if (typeof d !== 'object' || d === null)
        return false;
    const obj = d as {
        query?: unknown;
        type?: unknown;
    };
    return typeof obj.query === 'string' && typeof obj.type === 'string';
}
/** Validator: `{ value: string | string[] }`. */
function isValueStringOrArrayDetail(d: unknown): d is {
    value: string | string[];
} {
    if (typeof d !== 'object' || d === null)
        return false;
    const val: unknown = (d as {
        value?: unknown;
    }).value;
    if (typeof val === 'string')
        return true;
    return Array.isArray(val) && val.every(function (x) {
        return typeof x === 'string';
    });
}
/* -------------------- atlas-resource-picker specimens -------------------- */
const MOCK_RESOURCES: Array<{
    id: string;
    label: string;
    description: string;
    type: string;
}> = [
    { id: 'pg_welcome', label: 'Welcome', description: '/welcome', type: 'page' },
    { id: 'pg_about', label: 'About', description: '/about', type: 'page' },
    { id: 'pg_pricing', label: 'Pricing', description: '/pricing', type: 'page' },
    { id: 'pg_contact', label: 'Contact', description: '/contact', type: 'page' },
    { id: 'media_logo', label: 'logo.svg', description: '4 KB · SVG', type: 'media' },
    { id: 'media_hero', label: 'hero-banner.jpg', description: '1.2 MB · JPEG', type: 'media' },
    { id: 'user_brice', label: 'Brice', description: 'brice@acme.test', type: 'user' },
    { id: 'user_sandbox', label: 'Sandbox', description: 'sandbox@acme.test', type: 'user' },
];
S({
    id: 'resource-picker',
    name: 'ResourcePicker',
    tag: 'atlas-resource-picker',
    mount: function (demoEl, { config, onLog }) {
        const cfg = parseMountConfig<{
            multiple: boolean;
        }>(config, {
            multiple: v.boolean,
        });
        const multiple = cfg.multiple ?? false;
        const trigger = document.createElement('atlas-button');
        trigger.textContent = multiple ? 'Pick pages…' : 'Pick a page';
        const picker = document.createElement('atlas-resource-picker') as HTMLElement & {
            open: () => void;
            setResults: (items: Array<{
                id: string;
                label: string;
                description?: string;
            }>) => void;
        };
        picker.setAttribute('resource-type', 'page');
        if (multiple)
            picker.setAttribute('multiple', '');
        picker.addEventListener('request-results', function (ev) {
            const { query, type } = customDetail(ev, isQueryTypeDetail, 'atlas-resource-picker.request-results');
            onLog('request-results', { query, type });
            const q = query.toLowerCase();
            const filtered = MOCK_RESOURCES
                .filter(function (r) {
                return type === 'any' || r.type === type;
            })
                .filter(function (r) {
                return q === '' || r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
            })
                .map(function ({ id, label, description }) {
                return ({ id, label, description });
            });
            picker.setResults(filtered);
        });
        picker.addEventListener('change', function (ev) {
            onLog('change', customDetail(ev, isValueStringOrArrayDetail, 'atlas-resource-picker.change'));
        });
        trigger.addEventListener('click', function () {
            return picker.open();
        });
        demoEl.appendChild(trigger);
        demoEl.appendChild(picker);
        return function () {
            try {
                trigger.remove();
            }
            catch { /* noop */ }
            try {
                picker.remove();
            }
            catch { /* noop */ }
        };
    },
    configVariants: [
        { name: 'Single select', config: { multiple: false } },
        { name: 'Multi select', config: { multiple: true } },
    ],
});
