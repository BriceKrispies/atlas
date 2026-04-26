/**
 * Surface contract: authoring.page-editor (and authoring.page-editor.shell).
 *
 * The page editor route in the authoring app. Hosts the page editor shell
 * (`<authoring-page-editor-shell>`) inside an authoring route surface with
 * a seed-page picker for switching between starter pages.
 *
 * The inner shell is its own surface (`authoring.page-editor.shell`) with
 * three modes — structure, content, preview — accessible from a top action
 * bar. Layout: a left rail, a top topbar, a primary canvas, and a single
 * right drawer whose contents swap by drawer state.
 */

import type {
  SurfaceAuth,
  SurfaceStateSpec,
  SurfaceElementSpec,
  SurfaceTelemetryEventSpec,
  SurfaceAcceptanceScenario,
  SurfaceContract,
} from './_contract-types.ts';

export type {
  SurfaceAuth,
  SurfaceStateSpec,
  SurfaceElementSpec,
  SurfaceTelemetryEventSpec,
  SurfaceAcceptanceScenario,
  SurfaceContract,
};

export const contract: SurfaceContract = {
  surfaceId: 'authoring.page-editor',
  kind: 'page',
  route: '#/page-editor',
  purpose:
    'Authoring-app route that hosts the page editor against the authoring page store, with a picker to switch between seeded starter pages.',

  auth: {
    required: false,
    roles: [],
    permissions: [],
  },

  states: {
    loading: {
      applies: false,
      description:
        'Route renders synchronously against an in-memory store; the inner editor shell handles its own mount lifecycle.',
      testId: 'authoring.page-editor.state-loading',
      rationale:
        'No async fetch happens at the route level — seed pages are saved into an in-memory store at module load.',
    },
    empty: {
      applies: false,
      description: 'Seed pages always exist, so an empty state cannot appear at this surface.',
      testId: 'authoring.page-editor.state-empty',
      rationale:
        'The route is a developer/authoring tool with bundled seed pages; the empty case is exercised by the editor-blank seed itself.',
    },
    success: {
      applies: true,
      description: 'Picker plus inner editor shell mounted against the active seed page.',
      testId: 'authoring.page-editor.state-success',
    },
    validationError: {
      applies: false,
      description: 'Inner editor surfaces commit/validation feedback through its own state.',
      testId: 'authoring.page-editor.state-validation-error',
      rationale: 'No form lives at the route level.',
    },
    backendError: {
      applies: false,
      description: 'Authoring uses an in-memory store, so there is no backend to fail.',
      testId: 'authoring.page-editor.state-error',
      rationale: 'No HTTP calls are made from this route surface.',
    },
    unauthorized: {
      applies: false,
      description: 'Authoring tool is unauthenticated; auth.required is false.',
      testId: 'authoring.page-editor.state-unauthorized',
      rationale: 'No auth requirement on the authoring app today.',
    },
  },

  elements: [
    {
      name: 'page-select',
      type: 'atlas-select',
      testId: 'authoring.page-editor.page-select',
      purpose: 'Switch the active seed page mounted in the editor shell',
    },
  ],

  telemetryEvents: [
    {
      eventName: 'authoring.page-editor.seed-changed',
      trigger: 'User picks a different seed page from the picker',
      properties: ['fromPageId', 'toPageId', 'correlationId'],
    },
  ],

  acceptanceScenarios: [
    {
      name: 'Route mounts with the editor shell',
      given: 'User has loaded the authoring app',
      when: 'User navigates to #/page-editor',
      then: 'Route surface mounts, the page select is visible, and the inner editor shell renders',
    },
    {
      name: 'Switching seed pages remounts the editor',
      given: 'Page editor route is mounted on the starter seed page',
      when: 'User selects a different seed page from the picker',
      then: 'Editor shell remounts against the chosen page',
    },
  ],
};

/**
 * Inner shell contract — referenced by acceptance tests against the three
 * editor modes, drawer state machine, and undo/redo.
 */
export const shellContract: SurfaceContract = {
  surfaceId: 'authoring.page-editor.shell',
  kind: 'widget',
  route: '#/page-editor',
  purpose:
    'Three-mode page editor: structure, content, preview. Top action bar drives mode + undo/redo + save + preview toggle. A single right drawer hosts palette / settings / template content depending on state.',

  auth: {
    required: false,
    roles: [],
    permissions: [],
  },

  states: {
    loading: {
      applies: false,
      description: 'Shell mounts synchronously against the supplied page store.',
      testId: 'authoring.page-editor.shell.state-loading',
    },
    empty: {
      applies: false,
      description: 'A page document is always present once mounted; empty regions are rendered by the canvas itself.',
      testId: 'authoring.page-editor.shell.state-empty',
    },
    success: {
      applies: true,
      description: 'Editor shell rendered with rail, topbar, canvas, and drawer (drawer hidden in preview mode).',
      testId: 'authoring.page-editor.shell.state-success',
    },
    validationError: {
      applies: true,
      description: 'Property panel surfaces config validation errors inline when an edit is rejected by the editor.',
      testId: 'authoring.page-editor.shell.state-validation-error',
    },
    backendError: {
      applies: false,
      description: 'Authoring runs against an in-memory store; no backend errors are surfaced.',
      testId: 'authoring.page-editor.shell.state-error',
    },
    unauthorized: {
      applies: false,
      description: 'Authoring tool has no auth gate.',
      testId: 'authoring.page-editor.shell.state-unauthorized',
    },
  },

  elements: [
    {
      name: 'mode-structure',
      type: 'atlas-segmented-control segment',
      testId: 'authoring.page-editor.shell.mode.mode-structure',
      purpose: 'Switch the shell to structure mode',
    },
    {
      name: 'mode-content',
      type: 'atlas-segmented-control segment',
      testId: 'authoring.page-editor.shell.mode.mode-content',
      purpose: 'Switch the shell to content mode',
    },
    {
      name: 'mode-preview',
      type: 'atlas-segmented-control segment',
      testId: 'authoring.page-editor.shell.mode.mode-preview',
      purpose: 'Switch the shell to preview mode',
    },
    {
      name: 'template-select',
      type: 'atlas-select',
      testId: 'authoring.page-editor.shell.template-select',
      purpose: 'Pick the layout/template (rendered in the left-panel templates tab)',
    },
    {
      name: 'widget-instance',
      type: 'data-widget-cell',
      testId: 'authoring.page-editor.shell.widget-instance',
      parameterized: true,
      purpose: 'A rendered widget instance on the canvas; combine with data-instance-id to disambiguate',
    },
    {
      name: 'left-panel',
      type: 'page-editor-left-panel',
      testId: 'authoring.page-editor.shell.left-panel',
      purpose: 'Left panel host (palette / templates / outline tabs). Surface: authoring.page-editor.shell.left-panel.',
    },
    {
      name: 'right-panel',
      type: 'page-editor-right-panel',
      testId: 'authoring.page-editor.shell.right-panel',
      purpose: 'Right panel host (inspector). Surface: authoring.page-editor.shell.right-panel.',
    },
    {
      name: 'bottom-panel',
      type: 'page-editor-bottom-panel',
      testId: 'authoring.page-editor.shell.bottom-panel',
      purpose: 'Bottom panel host (issues / history / preview-device tabs). Surface: authoring.page-editor.shell.bottom-panel.',
    },
    {
      name: 'add-widget-tab-content',
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.add-widget-tab-content',
      purpose: 'Left-panel palette tab content',
    },
    {
      name: 'settings-tab-content',
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.settings-tab-content',
      purpose: 'Right-panel settings tab content (a property-panel form for the inspected widget)',
    },
    {
      name: 'settings-empty-content',
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.settings-empty-content',
      purpose: 'Right-panel settings tab content when no widget is inspected',
    },
    {
      name: 'templates-tab-content',
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.templates-tab-content',
      purpose: 'Left-panel templates tab content (in structure mode)',
    },
    {
      name: 'issues-tab-content',
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.issues-tab-content',
      purpose: 'Bottom-panel issues tab placeholder (S5/S6 fills with real content)',
    },
    {
      name: 'open-left',
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.open-left',
      purpose: 'Floating canvas-edge button that re-opens the left panel when collapsed',
    },
    {
      name: 'open-right',
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.open-right',
      purpose: 'Floating canvas-edge button that re-opens the right panel when collapsed',
    },
    {
      name: 'open-bottom',
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.open-bottom',
      purpose: 'Floating canvas-edge button that re-opens the bottom panel when collapsed',
    },
    {
      name: 'canvas',
      type: 'atlas-box',
      testId: 'authoring.page-editor.shell.canvas',
      purpose: 'Primary working area hosting the content-page',
    },
    {
      name: 'slot-drop-target',
      type: 'section',
      testId: 'authoring.page-editor.shell.slot-drop-target',
      parameterized: true,
      purpose: 'Drop target for a region/slot; combine with data-region attribute',
    },
    {
      name: 'save',
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.save',
      purpose: 'Trigger an explicit save (in-memory: no-op pulse)',
    },
    {
      name: 'undo',
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.undo',
      purpose: 'Undo the last document mutation',
    },
    {
      name: 'redo',
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.redo',
      purpose: 'Redo the next undone mutation',
    },
    {
      name: 'preview-toggle',
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.preview-toggle',
      purpose: 'Switch into preview mode (hides editor chrome)',
    },
    {
      name: 'exit-preview',
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.exit-preview',
      purpose: 'Visible only in preview mode; returns to content mode',
    },
  ],

  /**
   * Every shell-level intent is recorded as a commit on the
   * `editor:<pageId>:shell` test-state surface; the names below are the
   * canonical telemetry event names that mirror those intents 1:1. The
   * runtime emission is scheduled to land alongside the shared `@atlas/telemetry`
   * package; until then the contract names are authoritative for tests.
   */
  telemetryEvents: [
    {
      eventName: 'authoring.page-editor.shell.mode-changed',
      trigger: 'Mode tab clicked or `controller.setMode(mode)` invoked',
      properties: ['mode', 'previousMode', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.widget-selected',
      trigger: 'Canvas widget cell clicked (with optional shift/meta modifier)',
      properties: ['instanceId', 'additive', 'selectionSize', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.palette-opened',
      trigger: 'Drawer transitions into palette (selection cleared in content mode)',
      properties: ['correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.settings-opened',
      trigger: 'Drawer transitions into settings for a single selected widget',
      properties: ['instanceId', 'widgetId', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.drawer-closed',
      trigger: 'Drawer is explicitly closed',
      properties: ['correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.widget-added',
      trigger: 'Palette chip click or `controller.addWidget(args)` succeeds',
      properties: ['widgetId', 'region', 'instanceId', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.widget-removed',
      trigger: 'Single-widget remove succeeds',
      properties: ['instanceId', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.selection-removed',
      trigger: 'Multi-select Delete/Backspace removes 1+ widget(s)',
      properties: ['attempted', 'removed', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.widget-config-updated',
      trigger: 'Property panel commits a config change',
      properties: ['instanceId', 'fieldsChanged', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.template-changed',
      trigger: 'Template-select drawer commits a new template',
      properties: ['from', 'to', 'widgetsRemoved', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.undone',
      trigger: 'Undo button or Cmd/Ctrl+Z',
      properties: ['correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.redone',
      trigger: 'Redo button or Cmd/Ctrl+Shift+Z / Cmd+Y',
      properties: ['correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.saved',
      trigger: 'Save button (in-memory pulse; networked store hooks here)',
      properties: ['correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.panel-toggled',
      trigger: 'Panel collapse button or canvas-edge open button',
      properties: ['panel', 'open', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.panel-resized',
      trigger: 'User drags a panel resize handle to a new size',
      properties: ['panel', 'size', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.panel-tab-changed',
      trigger: 'User clicks a tab in a multi-tab panel',
      properties: ['panel', 'tab', 'correlationId'],
    },
  ],

  acceptanceScenarios: [
    {
      name: 'Switching modes updates the shell',
      given: 'Editor is mounted on a seeded page',
      when: 'User picks a different mode tab',
      then: 'data-mode reflects the new mode, the drawer state machine adjusts, rail visibility tracks preview',
    },
    {
      name: 'Adding a widget commits to the document',
      given: 'Editor is mounted on a blank seed',
      when: 'User triggers add via the palette or imperative API',
      then: 'A new widget instance appears in the page document and the canvas re-renders',
    },
    {
      name: 'Selecting a widget opens the settings drawer',
      given: 'Editor is in content mode with at least one widget',
      when: 'User clicks a widget cell',
      then: 'Drawer state becomes settings and the property panel renders the widget config',
    },
    {
      name: 'Preview mode hides editor chrome',
      given: 'Editor is in content mode',
      when: 'User switches into preview mode',
      then: 'Rail is hidden, drawer is hidden, mode tabs are hidden, exit-preview is visible',
    },
    {
      name: 'Undo / redo round-trip the document',
      given: 'Editor is mounted with history enabled',
      when: 'User adds a widget, undoes, redoes',
      then: 'Document state alternates and the canvas reflects each frame',
    },
  ],
};
