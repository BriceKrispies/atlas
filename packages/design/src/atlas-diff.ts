import { AtlasElement } from '@atlas/core';
import { adoptSheet, createSheet, escapeText } from './util.ts';

/**
 * <atlas-diff> — agent-oriented side-by-side / unified line-diff viewer.
 *
 * Mobile-first, framework-free. Implements a small Longest-Common-
 * Subsequence (LCS) line diff in pure TypeScript — no third-party diff
 * libraries. The algorithm is O(n*m) in time/space; we cap input at
 * 5,000 lines on either side. Anything larger renders an explicit
 * "diff too large to render" empty-state instead of grinding the main
 * thread to a halt.
 *
 * Computation is scheduled asynchronously via `requestIdleCallback`
 * (with a `setTimeout` fallback). `@atlas/core` does not currently
 * expose an `offload()` worker primitive; when it does, swap the
 * idle-callback path for `offload()` without changing the public API.
 *
 * Attributes:
 *   before    — original text (string).
 *   after     — modified text (string).
 *   view      — "unified" (default) | "split"
 *   language  — optional syntax hint (purely informational; the diff
 *               renderer does not syntax-highlight tokens — it only
 *               colour-codes line additions / deletions).
 *
 * Accessibility:
 *   - `role="region"` with `aria-label="Diff"` on the host.
 *   - Each diff hunk uses `role="list"` and lines `role="listitem"`.
 *   - Additions/deletions also carry text prefixes (`+`, `-`, ` `)
 *     so the signal is not colour-only (C3.11).
 *
 * Shadow DOM, encapsulated styles via adoptSheet().
 */
export type AtlasDiffView = 'unified' | 'split';

interface DiffLine {
  kind: 'context' | 'add' | 'del';
  beforeNo: number | null;
  afterNo: number | null;
  text: string;
}

const MAX_LINES = 5000;
const TRUNCATE_RENDERED = 2000;

const sheet = createSheet(`
  :host {
    display: block;
    border: 1px solid var(--atlas-color-border);
    border-radius: var(--atlas-radius-md);
    background: var(--atlas-color-bg);
    color: var(--atlas-color-text);
    font-family: var(--atlas-font-family-mono, ui-monospace, SFMono-Regular, monospace);
    font-size: var(--atlas-font-size-sm);
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--atlas-space-sm);
    padding: var(--atlas-space-sm) var(--atlas-space-md);
    border-bottom: 1px solid var(--atlas-color-border);
    background: var(--atlas-color-surface);
    font-family: var(--atlas-font-family);
    font-size: var(--atlas-font-size-sm);
    color: var(--atlas-color-text-muted);
    min-height: var(--atlas-touch-target-min, 44px);
  }
  .header .meta { display: flex; gap: var(--atlas-space-md); }
  .header .meta .added { color: var(--atlas-color-success-text, #15603a); }
  .header .meta .removed { color: var(--atlas-color-danger); }
  .scroll {
    overflow: auto;
    max-height: 60vh;
    -webkit-overflow-scrolling: touch;
  }
  .empty {
    padding: var(--atlas-space-xl);
    text-align: center;
    color: var(--atlas-color-text-muted);
    font-family: var(--atlas-font-family);
  }
  .pane {
    display: grid;
    grid-template-columns: auto auto 1fr;
    align-items: stretch;
  }
  /* Split view: two columns side-by-side. Stacks on narrow viewports. */
  .split {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0;
  }
  @media (min-width: 640px) {
    .split { grid-template-columns: 1fr 1fr; }
    .split > .pane:first-child { border-right: 1px solid var(--atlas-color-border); }
  }
  .row {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    align-items: baseline;
  }
  .gutter, .marker, .text {
    padding: 1px var(--atlas-space-sm);
    line-height: 1.5;
    white-space: pre;
    border-bottom: 1px solid transparent;
  }
  .gutter {
    color: var(--atlas-color-text-muted);
    text-align: right;
    user-select: none;
    min-width: 3ch;
    border-right: 1px solid var(--atlas-color-border);
    background: var(--atlas-color-surface);
  }
  .marker {
    width: 1.5ch;
    text-align: center;
    color: var(--atlas-color-text-muted);
    user-select: none;
  }
  .text { white-space: pre-wrap; word-break: break-word; }
  .row.add {
    background: var(--atlas-color-success-subtle, #f0fdf4);
  }
  .row.add .marker { color: var(--atlas-color-success-text, #15603a); font-weight: 600; }
  .row.add .text { color: var(--atlas-color-success-text, #15603a); }
  .row.del {
    background: var(--atlas-color-danger-subtle, #fef2f2);
  }
  .row.del .marker { color: var(--atlas-color-danger); font-weight: 600; }
  .row.del .text { color: var(--atlas-color-danger); }
  .row.placeholder {
    background: repeating-linear-gradient(
      45deg,
      var(--atlas-color-surface),
      var(--atlas-color-surface) 4px,
      var(--atlas-color-bg) 4px,
      var(--atlas-color-bg) 8px
    );
  }
  .truncated {
    padding: var(--atlas-space-md);
    text-align: center;
    background: var(--atlas-color-surface);
    color: var(--atlas-color-text-muted);
    border-top: 1px solid var(--atlas-color-border);
    font-family: var(--atlas-font-family);
  }
`);

export class AtlasDiff extends AtlasElement {
  static override get observedAttributes(): readonly string[] {
    return ['before', 'after', 'view', 'language'];
  }

  private _built = false;
  private _scheduled = false;
  private _idleHandle: number | null = null;
  private _shellHeader: HTMLElement | null = null;
  private _shellBody: HTMLElement | null = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    adoptSheet(root, sheet);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this._built) this._buildShell();
    this.setAttribute('role', 'region');
    if (!this.hasAttribute('aria-label')) this.setAttribute('aria-label', 'Diff');
    this._scheduleRender();
  }

  override disconnectedCallback(): void {
    this._cancelIdle();
  }

  override attributeChangedCallback(name: string): void {
    if (!this._built) return;
    if (name === 'before' || name === 'after' || name === 'view' || name === 'language') {
      this._scheduleRender();
    }
  }

  private _buildShell(): void {
    const root = this.shadowRoot;
    if (!root) return;
    const header = document.createElement('div');
    header.className = 'header';
    const body = document.createElement('div');
    body.className = 'scroll';
    root.appendChild(header);
    root.appendChild(body);
    this._shellHeader = header;
    this._shellBody = body;
    this._built = true;
  }

  private _cancelIdle(): void {
    if (this._idleHandle != null) {
      const w = window as Window & { cancelIdleCallback?: (h: number) => void };
      if (typeof w.cancelIdleCallback === 'function') {
        w.cancelIdleCallback(this._idleHandle);
      } else {
        clearTimeout(this._idleHandle);
      }
      this._idleHandle = null;
    }
  }

  private _scheduleRender(): void {
    if (this._scheduled) return;
    this._scheduled = true;
    const run = (): void => {
      this._scheduled = false;
      this._idleHandle = null;
      this._render();
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    };
    if (typeof w.requestIdleCallback === 'function') {
      this._idleHandle = w.requestIdleCallback(run, { timeout: 200 });
    } else {
      this._idleHandle = window.setTimeout(run, 0) as unknown as number;
    }
  }

  private _render(): void {
    if (!this._shellBody || !this._shellHeader) return;
    const before = this.getAttribute('before') ?? '';
    const after = this.getAttribute('after') ?? '';
    const view: AtlasDiffView = this.getAttribute('view') === 'split' ? 'split' : 'unified';
    const language = this.getAttribute('language') ?? '';

    const beforeLines = before.length === 0 ? [] : before.split(/\r?\n/);
    const afterLines = after.length === 0 ? [] : after.split(/\r?\n/);

    if (beforeLines.length > MAX_LINES || afterLines.length > MAX_LINES) {
      this._renderHeader({ added: 0, removed: 0, language, oversize: true });
      this._shellBody.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent =
        `Diff too large to render (${beforeLines.length} → ${afterLines.length} lines, max ${MAX_LINES}).`;
      this._shellBody.appendChild(empty);
      return;
    }

    const lines = computeLineDiff(beforeLines, afterLines);
    let added = 0;
    let removed = 0;
    for (const l of lines) {
      if (l.kind === 'add') added += 1;
      else if (l.kind === 'del') removed += 1;
    }
    this._renderHeader({ added, removed, language, oversize: false });

    this._shellBody.innerHTML = '';
    if (view === 'split') {
      this._shellBody.appendChild(renderSplit(lines));
    } else {
      this._shellBody.appendChild(renderUnified(lines));
    }
  }

  private _renderHeader(info: {
    added: number;
    removed: number;
    language: string;
    oversize: boolean;
  }): void {
    if (!this._shellHeader) return;
    const langText = info.language ? `· ${info.language}` : '';
    if (info.oversize) {
      this._shellHeader.innerHTML = `
        <span>Diff ${escapeText(langText)}</span>
        <span class="meta">truncated</span>
      `;
      return;
    }
    this._shellHeader.innerHTML = `
      <span>Diff ${escapeText(langText)}</span>
      <span class="meta">
        <span class="added">+${info.added}</span>
        <span class="removed">−${info.removed}</span>
      </span>
    `;
  }
}

/* -------------------- LCS line diff -------------------- */

/**
 * Compute a line-by-line diff using a classic LCS matrix and back-trace.
 * O(n*m) in time and space; callers MUST cap inputs upstream
 * (`MAX_LINES`) before invoking — this function trusts its inputs.
 */
function computeLineDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // Build the LCS length matrix as a flat Uint32Array for memory efficiency.
  const dp = new Uint32Array((n + 1) * (m + 1));
  const stride = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const idx = i * stride + j;
      if (a[i] === b[j]) {
        dp[idx] = (dp[idx + stride + 1] ?? 0) + 1;
      } else {
        const down = dp[idx + stride] ?? 0;
        const right = dp[idx + 1] ?? 0;
        dp[idx] = down >= right ? down : right;
      }
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let beforeNo = 1;
  let afterNo = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', beforeNo, afterNo, text: a[i] ?? '' });
      i++; j++; beforeNo++; afterNo++;
    } else {
      const down = dp[(i + 1) * stride + j] ?? 0;
      const right = dp[i * stride + (j + 1)] ?? 0;
      if (down >= right) {
        out.push({ kind: 'del', beforeNo, afterNo: null, text: a[i] ?? '' });
        i++; beforeNo++;
      } else {
        out.push({ kind: 'add', beforeNo: null, afterNo, text: b[j] ?? '' });
        j++; afterNo++;
      }
    }
  }
  while (i < n) {
    out.push({ kind: 'del', beforeNo, afterNo: null, text: a[i] ?? '' });
    i++; beforeNo++;
  }
  while (j < m) {
    out.push({ kind: 'add', beforeNo: null, afterNo, text: b[j] ?? '' });
    j++; afterNo++;
  }
  return out;
}

/* -------------------- Renderers -------------------- */

function renderUnified(lines: DiffLine[]): HTMLElement {
  const pane = document.createElement('div');
  pane.className = 'pane';
  pane.setAttribute('role', 'list');
  const truncated = lines.length > TRUNCATE_RENDERED;
  const slice = truncated ? lines.slice(0, TRUNCATE_RENDERED) : lines;
  for (const line of slice) {
    pane.appendChild(buildRow(line, /* showBoth */ true));
  }
  if (truncated) {
    const note = document.createElement('div');
    note.className = 'truncated';
    note.textContent = `Showing first ${TRUNCATE_RENDERED} of ${lines.length} diff lines.`;
    pane.appendChild(note);
  }
  return pane;
}

function renderSplit(lines: DiffLine[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'split';
  const left = document.createElement('div');
  left.className = 'pane';
  left.setAttribute('role', 'list');
  left.setAttribute('aria-label', 'Before');
  const right = document.createElement('div');
  right.className = 'pane';
  right.setAttribute('role', 'list');
  right.setAttribute('aria-label', 'After');
  wrap.appendChild(left);
  wrap.appendChild(right);

  const truncated = lines.length > TRUNCATE_RENDERED;
  const slice = truncated ? lines.slice(0, TRUNCATE_RENDERED) : lines;
  for (const line of slice) {
    if (line.kind === 'context') {
      left.appendChild(buildRow(line, false, 'before'));
      right.appendChild(buildRow(line, false, 'after'));
    } else if (line.kind === 'del') {
      left.appendChild(buildRow(line, false, 'before'));
      right.appendChild(buildRow({ kind: 'context', beforeNo: null, afterNo: null, text: '' }, false, 'placeholder'));
    } else {
      left.appendChild(buildRow({ kind: 'context', beforeNo: null, afterNo: null, text: '' }, false, 'placeholder'));
      right.appendChild(buildRow(line, false, 'after'));
    }
  }
  if (truncated) {
    const note = document.createElement('div');
    note.className = 'truncated';
    note.style.gridColumn = '1 / -1';
    note.textContent = `Showing first ${TRUNCATE_RENDERED} of ${lines.length} diff lines.`;
    wrap.appendChild(note);
  }
  return wrap;
}

function buildRow(
  line: DiffLine,
  showBoth: boolean,
  paneKind?: 'before' | 'after' | 'placeholder',
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';
  row.setAttribute('role', 'listitem');
  if (paneKind === 'placeholder') {
    row.classList.add('placeholder');
  } else if (line.kind === 'add') {
    row.classList.add('add');
  } else if (line.kind === 'del') {
    row.classList.add('del');
  }

  const gutter = document.createElement('span');
  gutter.className = 'gutter';
  if (paneKind === 'before') {
    gutter.textContent = line.beforeNo == null ? '' : String(line.beforeNo);
  } else if (paneKind === 'after') {
    gutter.textContent = line.afterNo == null ? '' : String(line.afterNo);
  } else if (paneKind === 'placeholder') {
    gutter.textContent = '';
  } else {
    // unified: show whichever number is meaningful; "before/after" pair
    const beforeStr = line.beforeNo == null ? '·' : String(line.beforeNo);
    const afterStr = line.afterNo == null ? '·' : String(line.afterNo);
    gutter.textContent = showBoth ? `${beforeStr}/${afterStr}` : beforeStr;
  }
  row.appendChild(gutter);

  const marker = document.createElement('span');
  marker.className = 'marker';
  marker.setAttribute('aria-hidden', 'true');
  if (paneKind === 'placeholder') marker.textContent = '';
  else if (line.kind === 'add') marker.textContent = '+';
  else if (line.kind === 'del') marker.textContent = '−';
  else marker.textContent = ' ';
  row.appendChild(marker);

  const text = document.createElement('span');
  text.className = 'text';
  // Screen-reader prefix so additions/deletions are not conveyed by colour alone.
  if (paneKind !== 'placeholder') {
    if (line.kind === 'add') {
      const sr = document.createElement('span');
      sr.style.position = 'absolute';
      sr.style.width = '1px';
      sr.style.height = '1px';
      sr.style.overflow = 'hidden';
      sr.style.clip = 'rect(0 0 0 0)';
      sr.textContent = 'added: ';
      text.appendChild(sr);
    } else if (line.kind === 'del') {
      const sr = document.createElement('span');
      sr.style.position = 'absolute';
      sr.style.width = '1px';
      sr.style.height = '1px';
      sr.style.overflow = 'hidden';
      sr.style.clip = 'rect(0 0 0 0)';
      sr.textContent = 'removed: ';
      text.appendChild(sr);
    }
  }
  text.appendChild(document.createTextNode(line.text));
  row.appendChild(text);

  return row;
}

AtlasElement.define('atlas-diff', AtlasDiff);

declare global {
  interface HTMLElementTagNameMap {
    'atlas-diff': AtlasDiff;
  }
}
