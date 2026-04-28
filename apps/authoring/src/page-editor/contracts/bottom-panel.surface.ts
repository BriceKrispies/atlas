/**
 * Surface contract: authoring.page-editor.shell.bottom-panel.
 *
 * The bottom panel is a three-tab utility drawer along the canvas edge. All
 * three tabs are stage-5/6 placeholders today; the host element exists and
 * is mounted by the shell, but the tab bodies are empty containers that
 * future stages fill.
 *
 *   - `issues`  (stage 5/6) — Validation issues digest: missing required
 *     widgets, broken references, schema warnings.
 *   - `history` (stage 6)   — Linear history view of the controller's
 *     undo/redo stack with timestamps and intent labels.
 *   - `preview-device` (stage 5) — Device-frame chooser used in preview
 *     mode (mobile/tablet/desktop). The dedicated preview surface
 *     (`authoring.page-editor.preview`) owns the rendering; this tab
 *     mirrors the device control for in-shell preview.
 *
 * Like the other panels, the shell remains the commit author for chrome
 * intents (`panelToggle` / `panelResize` / `panelTab`). Tab-specific
 * actions (clicking an issue to navigate, clicking a history frame to
 * scrub, picking a device frame) commit through the shell or — in the
 * case of device-pick — through the preview surface contract directly.
 */

import type { SurfaceContract } from './_contract-types.ts';

export const contract: SurfaceContract = {
  surfaceId: 'authoring.page-editor.shell.bottom-panel',
  kind: 'widget',
  route: '#/page-editor',
  purpose:
    'Bottom utility panel with three stage-5/6 tabs: issues digest, history scrubber, and preview-device chooser. Hosts placeholder content today; tab bodies fill out as later stages land.',

  auth: {
    required: false,
    roles: [],
    permissions: [],
  },

  states: {
    loading: {
      applies: false,
      description: 'Tab content is mounted from the in-memory store; no async work happens at this panel boundary.',
      testId: 'authoring.page-editor.shell.bottom-panel.state-loading',
      rationale: 'Issues, history, and device-pick all read from local state.',
    },
    empty: {
      applies: true,
      description:
        'Issues tab shows "No issues" copy when validation reports zero entries; history tab shows "No history" when the undo/redo stack is empty.',
      testId: 'authoring.page-editor.shell.bottom-panel.state-empty',
    },
    success: {
      applies: true,
      description:
        'Active tab body rendered (issues list, history list, or device chooser) with the correct tab marked active in the strip.',
      testId: 'authoring.page-editor.shell.bottom-panel.state-success',
    },
    validationError: {
      applies: false,
      description: 'No form lives in the bottom panel.',
      testId: 'authoring.page-editor.shell.bottom-panel.state-validation-error',
      rationale: 'Issues tab REPORTS validation errors but does not author them.',
    },
    backendError: {
      applies: false,
      description: 'Authoring uses an in-memory store; no backend errors surface here.',
      testId: 'authoring.page-editor.shell.bottom-panel.state-error',
      rationale: 'No HTTP calls originate from this panel.',
    },
    unauthorized: {
      applies: false,
      description: 'Authoring app is unauthenticated.',
      testId: 'authoring.page-editor.shell.bottom-panel.state-unauthorized',
      rationale: 'auth.required is false.',
    },
  },

  elements: [
    {
      name: 'collapse',
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.bottom-panel.collapse',
      purpose: 'Header collapse button; emits atlas-panel-toggle{open:false} which the shell records as panelToggle.',
    },
    {
      name: 'tab',
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.bottom-panel.tab',
      parameterized: true,
      purpose:
        'Tab strip button. Disambiguate by data-tab-id ∈ {issues, history, preview-device}. Click emits atlas-panel-tab; the shell commits panelTab { panel: "bottom", tab }.',
    },
    {
      name: 'resize-handle',
      type: 'div[role=separator]',
      testId: 'authoring.page-editor.shell.bottom-panel.resize-handle',
      purpose: 'Horizontal resize edge along the top of the panel. Pointer-drag commits panelResize { panel: "bottom", size }.',
    },
    {
      name: 'issues-tab-content',
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.issues-tab-content',
      purpose: 'Issues tab body. Stage-5/6 fills with the live validation digest; stage-2 ships the placeholder block.',
    },
    // stage 5/6
    {
      name: 'issue-row', // stage 5/6
      type: 'atlas-box',
      testId: 'authoring.page-editor.shell.bottom-panel.issue-row',
      parameterized: true,
      purpose: 'stage 5/6 — Single issue entry. Disambiguate by data-issue-id; clicking selects the affected widget on the canvas.',
    },
    // stage 6
    {
      name: 'history-tab-content', // stage 6
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.bottom-panel.history-tab-content',
      purpose: 'stage 6 — History tab body containing the linear undo/redo timeline.',
    },
    {
      name: 'history-frame', // stage 6
      type: 'atlas-box',
      testId: 'authoring.page-editor.shell.bottom-panel.history-frame',
      parameterized: true,
      purpose: 'stage 6 — Single frame in the history list. Disambiguate by data-frame-index; clicking scrubs to that frame via undo/redo.',
    },
    // stage 5
    {
      name: 'preview-device-tab-content', // stage 5
      type: 'atlas-stack',
      testId: 'authoring.page-editor.shell.bottom-panel.preview-device-tab-content',
      purpose: 'stage 5 — Preview-device tab body containing device-frame chooser controls.',
    },
    {
      name: 'device-option', // stage 5
      type: 'atlas-button',
      testId: 'authoring.page-editor.shell.bottom-panel.device-option',
      parameterized: true,
      purpose:
        'stage 5 — Device-frame option button. Disambiguate by data-device ∈ {mobile, tablet, desktop}. Click commits deviceChange on the preview surface.',
    },
  ],

  telemetryEvents: [
    {
      eventName: 'authoring.page-editor.shell.panel-toggled',
      trigger: 'Bottom-panel collapse button or canvas-edge open-bottom button',
      properties: ['panel', 'open', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.panel-resized',
      trigger: 'User drags the bottom-panel resize handle to a new height',
      properties: ['panel', 'size', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.shell.panel-tab-changed',
      trigger: 'User clicks a tab in the bottom-panel tab strip',
      properties: ['panel', 'tab', 'correlationId'],
    },
    {
      // stage 5/6
      eventName: 'authoring.page-editor.shell.bottom-panel.issue-selected',
      trigger: 'stage 5/6 — Issue row clicked; selects the affected widget on the canvas (mirrors selectWidget intent on the shell).',
      properties: ['issueId', 'instanceId', 'severity', 'correlationId'],
    },
    {
      // stage 6
      eventName: 'authoring.page-editor.shell.bottom-panel.history-frame-selected',
      trigger: 'stage 6 — History frame clicked; the controller scrubs to that frame via undo/redo and commits the resulting intent.',
      properties: ['frameIndex', 'direction', 'correlationId'],
    },
    {
      // stage 5
      eventName: 'authoring.page-editor.shell.bottom-panel.device-picked',
      trigger: 'stage 5 — User selects a device-frame option; the preview surface commits deviceChange.',
      properties: ['device', 'previousDevice', 'correlationId'],
    },
  ],

  acceptanceScenarios: [
    {
      name: 'Tab strip switches the active body',
      given: 'Bottom panel is open on the issues tab',
      when: 'User clicks the history tab button',
      then: 'data-active-tab on the panel becomes history, history-tab-content renders, and the shell commits panelTab { panel: "bottom", tab: "history" }.',
    },
    {
      name: 'Collapse button closes the panel',
      given: 'Bottom panel is open',
      when: 'User clicks the collapse button',
      then: 'data-open becomes false on the panel, the canvas-edge open-bottom button becomes visible, and the shell commits panelToggle { panel: "bottom", open: false }.',
    },
    {
      name: 'Resize handle adjusts the panel height',
      given: 'Bottom panel is open at the default height',
      when: 'User pointer-drags the resize handle by -80 CSS pixels (upward)',
      then: 'The panel size grows by ~80px clamped to PANEL_SIZE_BOUNDS.bottom, and the shell commits panelResize with the clamped value.',
    },
    {
      name: 'Issues tab renders an empty state when there are no issues', // stage 5/6
      given: 'stage 5/6 — Page document validates clean',
      when: 'User opens the bottom panel and selects the issues tab',
      then: 'issues-tab-content renders an empty-state hint and no issue-row elements appear.',
    },
    {
      name: 'History scrubber jumps to a specific frame', // stage 6
      given: 'stage 6 — User has performed at least three intents on the page',
      when: 'User opens the history tab and clicks an earlier frame',
      then: 'The controller undoes back to that frame, the canvas reflects the document at that moment, and a history-frame-selected event fires once.',
    },
  ],
};
