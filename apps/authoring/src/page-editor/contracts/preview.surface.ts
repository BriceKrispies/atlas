/**
 * Surface contract: authoring.page-editor.preview.
 *
 * Stage 5 deliverable. The shell currently renders preview inline by setting
 * `<content-page edit=false>` and hiding editor chrome; this contract
 * describes the dedicated preview surface that replaces that mode with a
 * `<page-editor-preview>` element. The preview surface lives at the same
 * route as the editor (`#/page-editor`) and mounts when the shell is in
 * preview mode; it is a sibling widget of the shell, not a route page.
 *
 * Responsibilities owned by this surface:
 *
 *   - Render the page document inside a chosen device frame (mobile,
 *     tablet, desktop).
 *   - Expose a breakpoint slider so users can preview the page at any
 *     viewport width within the device's bounds.
 *   - Provide an exit affordance that returns to content mode (mirrors
 *     the existing exit-preview button on the shell).
 *
 * lastCommit semantics:
 *   - `deviceChange` is the existing shell-level intent (declared in
 *     `state.ts` as part of the shell vocabulary in the planning notes;
 *     today it is referenced via the `bottom-panel.preview-device` tab).
 *     When the dedicated preview surface lands, deviceChange commits MAY
 *     originate either from the bottom-panel device-option buttons or from
 *     the preview surface's own device-tabs. Either way the patch shape is
 *     `{ device: 'mobile' | 'tablet' | 'desktop', previousDevice }` and
 *     the commit lands on `editor:<pageId>:shell`.
 *   - `breakpointSet` is owned locally by the preview surface. It does not
 *     mutate the page document — it only changes the preview frame width.
 *     The preview SHOULD register a reader at key
 *     `editor:<pageId>:preview` exposing `{ device, breakpointPx,
 *     lastCommit }` so tests can assert breakpoint changes without going
 *     through the shell. Patch shape: `{ breakpointPx: number,
 *     previousBreakpointPx: number }`.
 *
 * Note: `deviceChange` is NOT a member of the locked `PageEditorIntent`
 * union in `state.ts` today. Stage 5 will extend that union; until then
 * tests assert on the telemetry event name and on a future
 * `editor:<pageId>:preview` reader.
 */

import type { SurfaceContract } from './_contract-types.ts';

export const contract: SurfaceContract = {
  surfaceId: 'authoring.page-editor.preview',
  kind: 'widget',
  route: '#/page-editor',
  purpose:
    'Dedicated preview surface for stage 5: renders the active page document in a device frame (mobile/tablet/desktop) with a breakpoint slider and an exit affordance.',

  auth: {
    required: false,
    roles: [],
    permissions: [],
  },

  states: {
    loading: {
      applies: false,
      description: 'Preview mounts synchronously from the same in-memory document the shell uses.',
      testId: 'authoring.page-editor.preview.state-loading',
      rationale: 'No async fetch happens at the preview boundary.',
    },
    empty: {
      applies: true,
      description:
        'When the page document has no widgets, the preview frame renders the same blank-page indicator the canvas uses, plus a hint that nothing is on the page yet.',
      testId: 'authoring.page-editor.preview.state-empty',
    },
    success: {
      applies: true,
      description:
        'Device frame renders the page document at the chosen breakpoint width; device tabs and breakpoint slider reflect current state.',
      testId: 'authoring.page-editor.preview.state-success',
    },
    validationError: {
      applies: false,
      description: 'Preview is read-only; no validation flows through it.',
      testId: 'authoring.page-editor.preview.state-validation-error',
      rationale: 'No form lives in the preview surface.',
    },
    backendError: {
      applies: false,
      description: 'Authoring uses an in-memory store; no backend errors surface here.',
      testId: 'authoring.page-editor.preview.state-error',
      rationale: 'No HTTP calls originate from the preview surface today.',
    },
    unauthorized: {
      applies: false,
      description: 'Authoring app is unauthenticated.',
      testId: 'authoring.page-editor.preview.state-unauthorized',
      rationale: 'auth.required is false.',
    },
  },

  elements: [
    {
      name: 'device-tab',
      type: 'atlas-button',
      testId: 'authoring.page-editor.preview.device-tab',
      parameterized: true,
      purpose:
        'Device frame selector (segmented control). Disambiguate by data-device ∈ {mobile, tablet, desktop}. Click commits deviceChange on editor:<pageId>:shell and updates the local breakpoint to the device default.',
    },
    {
      name: 'breakpoint-slider',
      type: 'atlas-input',
      testId: 'authoring.page-editor.preview.breakpoint-slider',
      purpose:
        'Range input that scrubs the preview frame width within the device bounds. Each commit lands as breakpointSet on editor:<pageId>:preview with patch { breakpointPx, previousBreakpointPx }.',
    },
    {
      name: 'breakpoint-label',
      type: 'atlas-text',
      testId: 'authoring.page-editor.preview.breakpoint-label',
      purpose: 'Numeric label rendering the current breakpoint width in CSS pixels (e.g., "412 px").',
    },
    {
      name: 'frame',
      type: 'atlas-box',
      testId: 'authoring.page-editor.preview.frame',
      purpose: 'The device frame container that wraps the rendered page at the chosen breakpoint width.',
    },
    {
      name: 'page-render',
      type: 'content-page',
      testId: 'authoring.page-editor.preview.page-render',
      purpose: 'The page render inside the frame, mounted with edit=false. Same element the editor canvas mounts in content mode but configured for read-only display.',
    },
    {
      name: 'empty-hint',
      type: 'atlas-stack',
      testId: 'authoring.page-editor.preview.empty-hint',
      purpose: 'Empty-state copy shown when the document has no widgets.',
    },
    {
      name: 'exit-preview',
      type: 'atlas-button',
      testId: 'authoring.page-editor.preview.exit-preview',
      purpose:
        'Returns the shell to content mode. Mirrors the shell-level exit-preview button so the preview frame has its own exit affordance for keyboard/mouse users.',
    },
  ],

  telemetryEvents: [
    {
      eventName: 'authoring.page-editor.preview.entered',
      trigger: 'Preview surface mounts (shell mode transitions to preview)',
      properties: ['device', 'breakpointPx', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.preview.exited',
      trigger: 'User clicks exit-preview (or shell mode transitions away from preview)',
      properties: ['device', 'breakpointPx', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.preview.device-changed',
      trigger: 'User picks a different device-tab (or stage-5 bottom-panel device-option)',
      properties: ['device', 'previousDevice', 'breakpointPx', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.preview.breakpoint-set',
      trigger: 'User adjusts the breakpoint-slider; debounced commit lands when input value changes.',
      properties: ['breakpointPx', 'previousBreakpointPx', 'device', 'correlationId'],
    },
  ],

  acceptanceScenarios: [
    {
      name: 'Preview mounts on mode change',
      given: 'Editor is in content mode',
      when: 'User switches to preview mode (mode-preview tab or preview-toggle button)',
      then: 'authoring.page-editor.preview surface mounts with the default device frame, page-render contains the page document, and a preview.entered telemetry event is emitted.',
    },
    {
      name: 'Device tabs swap the frame',
      given: 'Preview is mounted on the desktop device',
      when: 'User clicks the mobile device-tab',
      then: 'The frame width snaps to the mobile default breakpoint, data-device on the surface becomes "mobile", editor:<pageId>:shell records a deviceChange commit, and a device-changed telemetry event fires with previousDevice "desktop".',
    },
    {
      name: 'Breakpoint slider scrubs the preview width',
      given: 'Preview is mounted on the tablet device at the default breakpoint',
      when: 'User drags the breakpoint-slider to 600',
      then: 'The frame width updates to 600px, the breakpoint-label reads "600 px", and editor:<pageId>:preview records a breakpointSet commit with patch { breakpointPx: 600 }.',
    },
    {
      name: 'Empty page shows the hint',
      given: 'Preview is mounted on a blank seed page with no widgets',
      when: 'The surface is in success state at any breakpoint',
      then: 'empty-hint is visible inside the frame and page-render contains no widget instances.',
    },
    {
      name: 'Exit-preview returns to content mode',
      given: 'Preview is mounted',
      when: 'User clicks exit-preview',
      then: 'The shell mode becomes content, the preview surface unmounts, a preview.exited event fires, and the shell commits setMode with patch { mode: "content", previousMode: "preview" }.',
    },
  ],
};
