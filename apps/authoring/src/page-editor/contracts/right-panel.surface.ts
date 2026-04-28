/**
 * Surface contract: authoring.page-editor.shell.right-panel.
 *
 * The right panel hosts the inspector. Today (stage 2) it has a single tab
 * — `settings` — whose body is one of two existing tab-content blocks:
 *
 *   - `settings-tab-content` when exactly one widget is selected (renders
 *     a property-panel form for that widget's config).
 *   - `settings-empty-content` when no widget is selected.
 *
 * Stage 4 expands the inspector with grouped sections, multi-select editing,
 * and copy/paste of widget config. Those elements are listed below with a
 * `// stage 4` marker; they describe what the contract anticipates, not
 * what the host element must render today.
 *
 * The shell remains the commit author for `panelToggle`, `panelResize`,
 * and `panelTab` (chrome events); for `updateWidgetConfig` (which
 * originates inside the inspector form). Stage-4 multi-select edit and
 * copy/paste introduce new patch shapes the right-panel SHOULD register
 * via its own `editor:<pageId>:right-panel` reader exposing `{ activeTab,
 * inspectedInstanceIds, clipboardWidgetId | null }`.
 */

import type { SurfaceContract } from './_contract-types.ts';

export const contract: SurfaceContract = {
  surfaceId: 'authoring.page-editor.shell.right-panel',
  kind: 'widget',
  route: '#/page-editor',
  purpose:
    'Right-side inspector panel for the page editor: shows the property panel for the selected widget(s), plus stage-4 grouped sections, multi-select edit, and copy/paste config.',

  auth: {
    required: false,
    roles: [],
    permissions: [],
  },

  states: {
    loading: {
      applies: false,
      description: 'Inspector content mounts synchronously from the shell snapshot.',
      testId: 'authoring.page-editor.shell.right-panel.state-loading',
      rationale: 'No async fetch happens at this panel; selection state is in-memory.',
    },
    empty: {
      applies: true,
      description:
        'Settings empty-content block ("Select a widget to edit its settings") rendered when no widget is selected.',
      testId: 'authoring.page-editor.shell.right-panel.state-empty',
    },
    success: {
      applies: true,
      description:
        'Property panel renders the inspected widget config (or grouped sections for stage 4); the panel is open with the settings tab active.',
      testId: 'authoring.page-editor.shell.right-panel.state-success',
    },
    validationError: {
      applies: true,
      description:
        'Property-panel form surfaces inline field-level errors when a config edit is rejected by the editor (e.g., a widget schema validator returns a reason).',
      testId: 'authoring.page-editor.shell.right-panel.state-validation-error',
    },
    backendError: {
      applies: false,
      description: 'Authoring uses an in-memory store; no backend errors surface in the inspector.',
      testId: 'authoring.page-editor.shell.right-panel.state-error',
      rationale: 'No HTTP calls originate from the inspector today.',
    },
    unauthorized: {
      applies: false,
      description: 'Authoring app is unauthenticated.',
      testId: 'authoring.page-editor.shell.right-panel.state-unauthorized',
      rationale: 'auth.required is false.',
    },
  },

  elements: [
    {
      name: 'collapse',
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.right-panel.collapse',
      purpose: 'Header collapse button; emits atlas-panel-toggle{open:false} which the shell commits as panelToggle.',
    },
    {
      name: 'tab',
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.right-panel.tab',
      parameterized: true,
      purpose:
        'Tab strip button. Today the only tab is `settings`; the strip renders as a static title because there is only one tab. Future stages may add tabs (style, data, advanced) — disambiguate by data-tab-id.',
    },
    {
      name: 'resize-handle',
      type: 'div[role=separator]',
      testId: 'authoring.page-editor.shell.right-panel.resize-handle',
      purpose: 'Vertical resize edge. Pointer-drag emits atlas-panel-resize phases; the shell commits panelResize { panel: "right", size }.',
    },
    {
      name: 'settings-tab-content',
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.settings-tab-content',
      purpose: 'Property panel form for the inspected widget; commits updateWidgetConfig on the shell when edits are submitted.',
    },
    {
      name: 'settings-empty-content',
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.settings-empty-content',
      purpose: 'Empty-state copy shown when no widget is selected.',
    },
    // stage 4 — grouped sections inside the settings body. Each section is
    // independently collapsible. Names match the design tokens; new groups
    // MUST be appended with stage markers, never renamed.
    {
      name: 'settings-group', // stage 4
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.right-panel.settings-group',
      parameterized: true,
      purpose: 'stage 4 — A collapsible section inside settings. Disambiguate by data-group ∈ {content, style, data, advanced}.',
    },
    {
      name: 'settings-group-toggle', // stage 4
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.right-panel.settings-group-toggle',
      parameterized: true,
      purpose: 'stage 4 — Header button that expands/collapses one settings-group; disambiguate by data-group.',
    },
    {
      name: 'multi-select-summary', // stage 4
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.right-panel.multi-select-summary',
      purpose: 'stage 4 — Inspector body shown when ≥2 widgets are selected: lists shared editable fields and the selection size.',
    },
    {
      name: 'copy-config', // stage 4
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.right-panel.copy-config',
      purpose: 'stage 4 — Copies the inspected widget config to the editor clipboard.',
    },
    {
      name: 'paste-config', // stage 4
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.right-panel.paste-config',
      purpose: 'stage 4 — Pastes the clipboard config onto the inspected widget; commits updateWidgetConfig.',
    },
  ],

  telemetryEvents: [
    {
      eventName: 'authoring.page-editor.shell.panel-toggled',
      trigger: 'Right-panel collapse button or canvas-edge open-right button',
      properties: ['panel', 'open', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.panel-resized',
      trigger: 'User drags the right-panel resize handle to a new width',
      properties: ['panel', 'size', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.settings-opened',
      trigger: 'Drawer transitions into settings for a single selected widget (mirrors openSettings intent on the shell).',
      properties: ['instanceId', 'widgetId', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.widget-config-updated',
      trigger: 'Property panel commits a config change',
      properties: ['instanceId', 'fieldsChanged', 'correlationId'],
    },
    {
      // stage 4
      eventName: 'authoring.page-editor.shell.right-panel.settings-group-toggled',
      trigger: 'stage 4 — User expands or collapses a settings group section',
      properties: ['group', 'expanded', 'correlationId'],
    },
    {
      // stage 4
      eventName: 'authoring.page-editor.shell.right-panel.config-copied',
      trigger: 'stage 4 — User clicks copy-config; the inspected widget config is captured into the editor clipboard.',
      properties: ['instanceId', 'widgetId', 'correlationId'],
    },
    {
      // stage 4
      eventName: 'authoring.page-editor.shell.right-panel.config-pasted',
      trigger: 'stage 4 — User clicks paste-config; the clipboard config is applied via updateWidgetConfig.',
      properties: ['instanceId', 'widgetId', 'fieldsChanged', 'correlationId'],
    },
    {
      // stage 4
      eventName: 'authoring.page-editor.shell.right-panel.multi-select-edited',
      trigger: 'stage 4 — Inspector applies a shared field edit across all selected widgets; emits one event per affected instance.',
      properties: ['instanceIds', 'fieldsChanged', 'correlationId'],
    },
  ],

  acceptanceScenarios: [
    {
      name: 'Selecting a widget opens the inspector',
      given: 'Editor is in content mode with at least one widget on the canvas',
      when: 'User clicks a widget cell',
      then: 'data-open on the right panel becomes true, the settings-tab-content block renders the widget property form, and the shell commits openSettings.',
    },
    {
      name: 'No-selection shows the empty-content block',
      given: 'Editor is in content mode and no widget is selected',
      when: 'The right panel is open on the settings tab',
      then: 'settings-empty-content is the visible body and settings-tab-content is hidden.',
    },
    {
      name: 'Editing a config field commits an update',
      given: 'Inspector is open on a single widget',
      when: 'User changes a property-panel field and submits',
      then: 'The shell commits updateWidgetConfig with patch { instanceId, config }, the canvas re-renders the widget, and dirty status pulses through saving → saved.',
    },
    {
      name: 'Multi-select shows the shared-fields summary', // stage 4
      given: 'stage 4 — Two or more widgets are selected via shift-click',
      when: 'The right panel is open',
      then: 'multi-select-summary renders, settings-tab-content is hidden, and editing a shared field commits updateWidgetConfig once per affected instance with patch { fieldsChanged } reflecting only the field that changed.',
    },
    {
      name: 'Copy/paste round-trips a widget config', // stage 4
      given: 'stage 4 — Inspector is open on widget A and the clipboard is empty',
      when: 'User clicks copy-config on A, selects widget B, and clicks paste-config',
      then: 'B receives a updateWidgetConfig commit with the same config payload as A, and config-copied + config-pasted telemetry events are emitted in order.',
    },
  ],
};
