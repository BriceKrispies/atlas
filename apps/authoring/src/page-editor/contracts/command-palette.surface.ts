/**
 * Surface contract: authoring.page-editor.command-palette.
 *
 * Stage 6 deliverable. A modal command-palette dialog (Cmd-K / Ctrl-K)
 * for the page editor. Lets the user fuzzy-search and execute editor
 * actions (add a widget, switch mode, jump to a region, run undo/redo,
 * change template, save) without leaving the keyboard.
 *
 * The palette is a self-contained surface — its own AtlasSurface dialog
 * mounted at the document root and dismissable via Escape, click-outside,
 * or selecting a result. It does NOT add new editor primitives; selecting
 * a result calls into the existing controller intents on the shell.
 *
 * lastCommit semantics:
 *   - The palette OWNS its own commits and registers a reader at
 *     `editor:command-palette` exposing `{ open, query, results, focusedIndex,
 *     lastCommit }`. Patches are JSON-safe so Playwright can drive
 *     character-by-character typing and assert on each frame.
 *   - Palette intents (LOCAL, not shell intents):
 *       - `open`            patch: `{ trigger: 'shortcut' | 'menu' | 'api' }`
 *       - `dismiss`         patch: `{ reason: 'escape' | 'click-out' | 'select' }`
 *       - `queryTyped`      patch: `{ query: string, length: number }`
 *       - `resultFocused`   patch: `{ index: number, commandId: string }`
 *       - `resultSelected`  patch: `{ commandId: string, query: string }`
 *   - Selecting a result fires the underlying shell intent on
 *     `editor:<pageId>:shell` (e.g., setMode, addWidget, undo). Tests
 *     assert TWO commits: one on `editor:command-palette` (resultSelected)
 *     and one on `editor:<pageId>:shell` (the dispatched intent).
 *
 * Intent vocabulary not in the parent union: every patch above is local
 * to the palette surface. Stage 6 will not extend `PageEditorIntent` —
 * the palette is a separate surface with its own vocabulary by design.
 */

import type { SurfaceContract } from './_contract-types.ts';

export const contract: SurfaceContract = {
  surfaceId: 'authoring.page-editor.command-palette',
  kind: 'dialog',
  route: '',
  purpose:
    'Cmd-K palette for the page editor: fuzzy-search and execute any editor command from the keyboard. Mounted as a modal dialog above the shell when triggered; dismissable via Escape, click-outside, or selecting a result.',

  auth: {
    required: false,
    roles: [],
    permissions: [],
  },

  states: {
    loading: {
      applies: false,
      description: 'The command list is built synchronously from the static command registry plus the current shell snapshot (no fetch).',
      testId: 'authoring.page-editor.command-palette.state-loading',
      rationale: 'No async data backs the palette; commands are derived from local state.',
    },
    empty: {
      applies: true,
      description: 'When the user query matches zero commands, the result list renders an "No matching commands" entry.',
      testId: 'authoring.page-editor.command-palette.state-empty',
    },
    success: {
      applies: true,
      description:
        'Dialog is open, query input is focused, and the result list shows the top matches with the focused entry highlighted.',
      testId: 'authoring.page-editor.command-palette.state-success',
    },
    validationError: {
      applies: false,
      description: 'No multi-step form lives in the palette; selecting a result either fires immediately or expands to a follow-up palette frame.',
      testId: 'authoring.page-editor.command-palette.state-validation-error',
      rationale: 'Single-action commands cannot fail validation; future composite commands will own their own follow-up validation surfaces.',
    },
    backendError: {
      applies: false,
      description: 'Authoring runs against an in-memory store; no backend errors surface in the palette.',
      testId: 'authoring.page-editor.command-palette.state-error',
      rationale: 'No HTTP calls originate from the palette today.',
    },
    unauthorized: {
      applies: false,
      description: 'Authoring app is unauthenticated.',
      testId: 'authoring.page-editor.command-palette.state-unauthorized',
      rationale: 'auth.required is false.',
    },
  },

  elements: [
    {
      name: 'dialog',
      type: 'atlas-dialog',
      testId: 'authoring.page-editor.command-palette.dialog',
      purpose: 'The modal dialog wrapper. role="dialog" and aria-modal="true" enforced by atlas-dialog.',
    },
    {
      name: 'query-input',
      type: 'atlas-input',
      testId: 'authoring.page-editor.command-palette.query-input',
      purpose: 'Search input. Each keystroke commits queryTyped on editor:command-palette with the current query string.',
    },
    {
      name: 'result-list',
      type: 'atlas-stack',
      testId: 'authoring.page-editor.command-palette.result-list',
      purpose: 'Container for the result rows; carries role="listbox" with aria-activedescendant pointing at the focused result.',
    },
    {
      name: 'result',
      type: 'atlas-box',
      testId: 'authoring.page-editor.command-palette.result',
      parameterized: true,
      purpose:
        'Single command match. Disambiguate by data-command-id. Click or Enter on the focused row commits resultSelected on editor:command-palette and dispatches the underlying shell intent.',
    },
    {
      name: 'no-results',
      type: 'atlas-text',
      testId: 'authoring.page-editor.command-palette.no-results',
      purpose: '"No matching commands" copy shown when the query yields zero matches.',
    },
    {
      name: 'dismiss',
      type: 'atlas-button',
      testId: 'authoring.page-editor.command-palette.dismiss',
      purpose: 'Explicit close button (also escape-key target). Commits dismiss with patch { reason: "explicit" } and unmounts the dialog.',
    },
  ],

  telemetryEvents: [
    {
      eventName: 'authoring.page-editor.command-palette.opened',
      trigger: 'Cmd-K / Ctrl-K shortcut, menu item click, or programmatic open.',
      properties: ['trigger', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.command-palette.query-typed',
      trigger: 'Each query-input change after the standard input debounce (one event per debounced commit).',
      properties: ['queryLength', 'resultCount', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.command-palette.result-focused',
      trigger: 'ArrowUp/ArrowDown moves the focus highlight, or pointer hover changes the focused result.',
      properties: ['commandId', 'index', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.command-palette.result-selected',
      trigger: 'User presses Enter on the focused result or clicks a result row.',
      properties: ['commandId', 'queryLength', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.command-palette.dismissed',
      trigger: 'Palette closes via Escape, click-outside, dismiss button, or successful result selection.',
      properties: ['reason', 'correlationId'],
    },
  ],

  acceptanceScenarios: [
    {
      name: 'Cmd-K opens the palette',
      given: 'Editor shell is mounted and the palette is closed',
      when: 'User presses Cmd-K (macOS) or Ctrl-K (other platforms)',
      then: 'authoring.page-editor.command-palette dialog mounts, query-input is focused, editor:command-palette records an open commit, and a palette.opened telemetry event fires with trigger "shortcut".',
    },
    {
      name: 'Typing filters the result list',
      given: 'Palette is open with the full command list visible',
      when: 'User types "und"',
      then: 'editor:command-palette records a queryTyped commit with patch { query: "und", length: 3 }, the result list narrows to commands matching the substring, and the focused result is the top match.',
    },
    {
      name: 'Selecting a result executes the underlying intent',
      given: 'Palette is open and the "Undo" command is focused',
      when: 'User presses Enter',
      then: 'editor:command-palette records resultSelected { commandId: "undo" }, editor:<pageId>:shell records an undo commit, the palette dismisses with reason "select", and a palette.dismissed event fires.',
    },
    {
      name: 'Empty query state when nothing matches',
      given: 'Palette is open',
      when: 'User types a string that matches no command (e.g., "zzz")',
      then: 'no-results renders, no result rows are visible, and the focused index is -1.',
    },
    {
      name: 'Escape dismisses without firing an intent',
      given: 'Palette is open',
      when: 'User presses Escape',
      then: 'The dialog unmounts, editor:command-palette records dismiss { reason: "escape" }, and editor:<pageId>:shell receives no new commit.',
    },
  ],
};
