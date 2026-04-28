/**
 * Surface contract: authoring.page-editor.shell.left-panel.
 *
 * The left panel hosts the structural / authoring sidebars: the widget
 * palette (content mode), the templates picker (structure mode), and — from
 * stage 3 onward — the document outline tree. The panel host element
 * (`<page-editor-left-panel>`) is mounted by the shell and already lives in
 * the parent shell contract as the `left-panel` element; this contract
 * describes the chrome that the host renders (collapse button, tab strip,
 * resize handle) and the tab content slots it exposes.
 *
 * The shell remains the commit author for `panelToggle`, `panelResize`, and
 * `panelTab` intents — interactions that originate inside this panel emit
 * `atlas-panel-toggle`, `atlas-panel-resize`, and `atlas-panel-tab` DOM
 * events that the shell turns into commits on `editor:<pageId>:shell`.
 * The outline drag-reorder interaction (stage 3) is the first commit that
 * will originate from this panel; it lands as a `moveBlock`-style commit on
 * the inner editor surface (`editor:<pageId>`), NOT on the shell, per
 * `specs/frontend/interaction-contracts.md`.
 *
 * lastCommit semantics (per interaction-contracts.md):
 *   - chrome interactions (collapse, tab change, resize) → shell commits
 *     intents `panelToggle` / `panelTab` / `panelResize` with patch
 *     `{ panel: 'left', open|tab|size }`.
 *   - stage-3 outline drag-reorder → commits `moveBlock` on
 *     `editor:<pageId>` with patch `{ blockId, from, to }`. The drag
 *     session is observable via the existing `drag:layout` reader; the
 *     left-panel SHOULD register its own `editor:<pageId>:left-panel`
 *     reader exposing `{ activeTab, outlineDragId | null }` so tests can
 *     introspect outline-specific drag state without scraping DOM.
 */

import type {
  SurfaceContract,
} from './_contract-types.ts';

export const contract: SurfaceContract = {
  surfaceId: 'authoring.page-editor.shell.left-panel',
  kind: 'widget',
  route: '#/page-editor',
  purpose:
    'Left-side editor panel: hosts the widget palette (content mode), the templates picker (structure mode), and the document outline tree (stage 3). Chrome includes a collapse button, a tab strip, and a vertical resize handle.',

  auth: {
    required: false,
    roles: [],
    permissions: [],
  },

  states: {
    loading: {
      applies: false,
      description: 'Panel content is mounted synchronously from the shell snapshot.',
      testId: 'authoring.page-editor.shell.left-panel.state-loading',
      rationale:
        'The shell renders tab content from the in-memory page document; no async fetch occurs at the panel boundary.',
    },
    empty: {
      applies: true,
      description:
        'Outline tab renders an empty-state hint when the active page document has no widgets in any region.',
      testId: 'authoring.page-editor.shell.left-panel.state-empty',
    },
    success: {
      applies: true,
      description:
        'Active tab content rendered (palette chips, templates list, or outline tree) inside the panel body, with the correct tab marked active in the strip.',
      testId: 'authoring.page-editor.shell.left-panel.state-success',
    },
    validationError: {
      applies: false,
      description: 'No form lives in the left panel; validation surfaces on the right panel inspector.',
      testId: 'authoring.page-editor.shell.left-panel.state-validation-error',
      rationale: 'The left panel contains pickers and an outline view, not form inputs.',
    },
    backendError: {
      applies: false,
      description: 'Authoring runs against an in-memory store; no backend fetches happen in the left panel.',
      testId: 'authoring.page-editor.shell.left-panel.state-error',
      rationale: 'No HTTP calls originate from this panel today.',
    },
    unauthorized: {
      applies: false,
      description: 'Authoring app is unauthenticated.',
      testId: 'authoring.page-editor.shell.left-panel.state-unauthorized',
      rationale: 'auth.required is false at every authoring surface today.',
    },
  },

  elements: [
    {
      name: 'collapse',
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.left-panel.collapse',
      purpose: 'Header collapse button; emits atlas-panel-toggle{open:false} which the shell records as a panelToggle commit.',
    },
    {
      name: 'tab',
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.left-panel.tab',
      parameterized: true,
      purpose:
        'Tab strip button. Disambiguate by data-tab-id ∈ {palette, templates, outline}. Click emits atlas-panel-tab; the shell commits panelTab with patch { panel: "left", tab }.',
    },
    {
      name: 'resize-handle',
      type: 'div[role=separator]',
      testId: 'authoring.page-editor.shell.left-panel.resize-handle',
      purpose: 'Vertical resize edge. Pointer-drag emits atlas-panel-resize phases; the shell commits panelResize with patch { panel: "left", size }.',
    },
    // Tab content blocks. These elements are already declared on the parent
    // shell contract (since the shell mounts them into the panel body); they
    // are listed here too because tests targeting the left-panel surface
    // assert against them via the panel's data-active-tab attribute.
    {
      name: 'add-widget-tab-content',
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.add-widget-tab-content',
      purpose: 'Palette tab body: list of addable widgets for content mode.',
    },
    {
      name: 'templates-tab-content',
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.templates-tab-content',
      purpose: 'Templates tab body: layout/template picker for structure mode.',
    },
    // stage 3 — outline tab content. Implemented when the outline tree lands.
    {
      name: 'outline-tab-content', // stage 3
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.left-panel.outline-tab-content',
      purpose: 'stage 3 — Outline tree body: hierarchical view of regions and widget instances with drag-to-reorder.',
    },
    {
      name: 'outline-node', // stage 3
      type: 'atlas-box',
      testId: 'authoring.page-editor.shell.left-panel.outline-node',
      parameterized: true,
      purpose:
        'stage 3 — Single node in the outline tree. Disambiguate by data-instance-id (widget) or data-region (region row). Drag handle initiates a moveBlock-style commit on editor:<pageId>.',
    },
    {
      name: 'outline-empty', // stage 3
      type: 'atlas-text',
      testId: 'authoring.page-editor.shell.left-panel.outline-empty',
      purpose: 'stage 3 — Outline tab empty-state copy when the page has zero widgets.',
    },
  ],

  /**
   * Telemetry event names mirror the shell intents for chrome events
   * (panel-toggled / panel-resized / panel-tab-changed) so a single
   * Playwright assertion can verify both the commit on the shell surface
   * AND the emitted event. Outline-specific events (stage 3) are scoped to
   * this panel's namespace because the originating action lives here.
   */
  telemetryEvents: [
    {
      eventName: 'authoring.page-editor.shell.panel-toggled',
      trigger: 'Left-panel collapse button or canvas-edge open-left button',
      properties: ['panel', 'open', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.panel-tab-changed',
      trigger: 'User clicks a tab in the left-panel tab strip',
      properties: ['panel', 'tab', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.panel-resized',
      trigger: 'User drags the left-panel resize handle to a new width',
      properties: ['panel', 'size', 'correlationId'],
    },
    {
      // stage 3
      eventName: 'authoring.page-editor.shell.left-panel.outline-node-moved',
      trigger: 'stage 3 — Drag-reorder of a widget node within the outline tree commits a moveBlock on the inner editor.',
      properties: ['instanceId', 'fromRegion', 'fromIndex', 'toRegion', 'toIndex', 'correlationId'],
    },
    {
      // stage 3
      eventName: 'authoring.page-editor.shell.left-panel.outline-node-selected',
      trigger: 'stage 3 — Click on an outline node selects the matching widget on the canvas (mirrors selectWidget intent).',
      properties: ['instanceId', 'additive', 'correlationId'],
    },
  ],

  acceptanceScenarios: [
    {
      name: 'Tab strip switches the active body',
      given: 'Editor is in content mode and the left panel is open on the palette tab',
      when: 'User clicks the templates tab button',
      then: 'data-active-tab on the panel becomes templates, the templates-tab-content block is visible, and the shell commits panelTab with patch { panel: "left", tab: "templates" }.',
    },
    {
      name: 'Collapse button closes the panel',
      given: 'Left panel is open',
      when: 'User clicks the collapse button',
      then: 'Panel data-open becomes false, the canvas-edge open-left button becomes visible, and the shell commits panelToggle with patch { panel: "left", open: false }.',
    },
    {
      name: 'Resize handle adjusts the panel width',
      given: 'Left panel is open at the default width',
      when: 'User pointer-drags the resize handle by +60 CSS pixels',
      then: 'The panel size grows by ~60px clamped to PANEL_SIZE_BOUNDS.left, and the shell commits panelResize with the clamped size.',
    },
    {
      name: 'Outline tab shows an empty state on a blank page', // stage 3
      given: 'stage 3 — Editor is mounted on a blank seed page with no widgets',
      when: 'User switches the left panel to the outline tab',
      then: 'The outline-empty hint renders inside the outline tab body and no outline-node elements are present.',
    },
    {
      name: 'Outline drag-reorder moves a widget', // stage 3
      given: 'stage 3 — Editor has at least two widgets in the same region and the outline tab is active',
      when: 'User drags one outline-node above another within the same region',
      then: 'editor:<pageId> records a moveBlock commit with the new index, the canvas re-renders the new ordering, and the outline tree reflects the change.',
    },
  ],
};
