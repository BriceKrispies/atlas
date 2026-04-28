/**
 * Surface contract: authoring.page-editor.structure-grid.
 *
 * Stage 7 deliverable. The region-grid editor used inside structure mode.
 * Replaces the existing static templates picker with an interactive grid
 * surface where the user authors the page layout itself: defines region
 * cells, splits/merges cells, and resizes the column/row tracks.
 *
 * The structure-grid is a sibling widget of the canvas (also at
 * `#/page-editor`), mounted only when the shell is in structure mode. It
 * does not replace the templates-tab-content in the left panel — that
 * picker keeps its role as a starter-template chooser; the structure-grid
 * is the authoring surface for the chosen template's region geometry.
 *
 * lastCommit semantics:
 *   - The structure-grid OWNS its commits and registers a reader at
 *     `editor:<pageId>:structure-grid` exposing `{ tracks: { columns,
 *     rows }, regions: ReadonlyArray<{ name, columnSpan, rowSpan, column,
 *     row }>, selectedRegionName | null, lastCommit }`.
 *   - Structure-grid intents (LOCAL, not in the shell `PageEditorIntent`
 *     union):
 *       - `addRegion`     patch: `{ name, column, row, columnSpan, rowSpan }`
 *       - `removeRegion`  patch: `{ name }`
 *       - `renameRegion`  patch: `{ from, to }`
 *       - `splitRegion`   patch: `{ name, axis: 'row' | 'column', at }`
 *       - `mergeRegions`  patch: `{ names: readonly string[], into: string }`
 *       - `selectRegion`  patch: `{ name: string | null }`
 *       - `resizeTrack`   patch: `{ axis: 'row' | 'column', index: number,
 *                                   sizeFr: number, previousSizeFr: number }`
 *   - When the grid commits a structural change that mutates the page
 *     document (every intent above except `selectRegion`), it ALSO routes
 *     the resulting document through `setLayoutTemplate` on the shell so
 *     history captures the change as a single frame; tests assert two
 *     commits for those intents (structure-grid local + shell
 *     setLayoutTemplate).
 *
 * Intent vocabulary not in the parent union: every intent listed above is
 * local to this surface. Stage 7 may extend `PageEditorIntent` with an
 * `editStructure` umbrella intent for tooling, but the granular intents
 * stay local for selector precision.
 */

import type { SurfaceContract } from './_contract-types.ts';

export const contract: SurfaceContract = {
  surfaceId: 'authoring.page-editor.structure-grid',
  kind: 'widget',
  route: '#/page-editor',
  purpose:
    'Stage-7 region-grid editor. Authors the page layout geometry by defining region cells over a column/row track grid; supports add/remove/rename, split/merge, and track resize via pointer drag.',

  auth: {
    required: false,
    roles: [],
    permissions: [],
  },

  states: {
    loading: {
      applies: false,
      description: 'Grid mounts synchronously from the active page document and the in-memory layout template.',
      testId: 'authoring.page-editor.structure-grid.state-loading',
      rationale: 'No async fetch backs the grid; track + region geometry is part of the page document.',
    },
    empty: {
      applies: true,
      description: 'When the layout has zero regions (uncommon but reachable via removeRegion), the grid renders a placeholder hint with an "Add region" affordance.',
      testId: 'authoring.page-editor.structure-grid.state-empty',
    },
    success: {
      applies: true,
      description:
        'Grid renders the column/row tracks, every region cell with its name label, and resize handles between every pair of adjacent tracks. Selected region is highlighted.',
      testId: 'authoring.page-editor.structure-grid.state-success',
    },
    validationError: {
      applies: true,
      description:
        'Inline error surfaced when an authoring action would produce an invalid layout (overlapping regions, empty name, duplicate name). The rejected intent does not commit.',
      testId: 'authoring.page-editor.structure-grid.state-validation-error',
    },
    backendError: {
      applies: false,
      description: 'Authoring runs against an in-memory store; no backend errors surface in the grid.',
      testId: 'authoring.page-editor.structure-grid.state-error',
      rationale: 'No HTTP calls originate from this surface today.',
    },
    unauthorized: {
      applies: false,
      description: 'Authoring app is unauthenticated.',
      testId: 'authoring.page-editor.structure-grid.state-unauthorized',
      rationale: 'auth.required is false.',
    },
  },

  elements: [
    {
      name: 'grid',
      type: 'atlas-box',
      testId: 'authoring.page-editor.structure-grid.grid',
      purpose: 'Root grid container. Renders an N×M CSS grid that mirrors the document tracks.',
    },
    {
      name: 'region-cell',
      type: 'atlas-box',
      testId: 'authoring.page-editor.structure-grid.region-cell',
      parameterized: true,
      purpose:
        'Single region tile. Disambiguate by data-region-name. Click commits selectRegion; double-click opens an inline rename input.',
    },
    {
      name: 'region-name-input',
      type: 'atlas-input',
      testId: 'authoring.page-editor.structure-grid.region-name-input',
      purpose: 'Inline rename field activated by double-click on a region-cell. Submitting commits renameRegion; cancel reverts.',
    },
    {
      name: 'add-region',
      type: 'atlas-button',
      testId: 'authoring.page-editor.structure-grid.add-region',
      purpose: 'Toolbar button that adds a new region in the next free cell. Commits addRegion.',
    },
    {
      name: 'remove-region',
      type: 'atlas-button',
      testId: 'authoring.page-editor.structure-grid.remove-region',
      purpose: 'Toolbar button enabled when a region is selected. Commits removeRegion with the selected name.',
    },
    {
      name: 'split-region',
      type: 'atlas-button',
      testId: 'authoring.page-editor.structure-grid.split-region',
      parameterized: true,
      purpose:
        'Splits the selected region along an axis. Disambiguate by data-axis ∈ {row, column}. Commits splitRegion.',
    },
    {
      name: 'merge-regions',
      type: 'atlas-button',
      testId: 'authoring.page-editor.structure-grid.merge-regions',
      purpose:
        'Toolbar button enabled when ≥2 adjacent regions are selected. Commits mergeRegions with the union of names and a chosen surviving name.',
    },
    {
      name: 'track-resize-handle',
      type: 'div[role=separator]',
      testId: 'authoring.page-editor.structure-grid.track-resize-handle',
      parameterized: true,
      purpose:
        'Pointer-drag resize handle between two tracks. Disambiguate by data-axis ∈ {row, column} and data-track-index. Drag commits resizeTrack with the new fractional size.',
    },
    {
      name: 'validation-message',
      type: 'atlas-text',
      testId: 'authoring.page-editor.structure-grid.validation-message',
      purpose: 'Inline validation text shown next to the offending region or toolbar button when a structural intent is rejected. role="alert".',
    },
    {
      name: 'empty-hint',
      type: 'atlas-stack',
      testId: 'authoring.page-editor.structure-grid.empty-hint',
      purpose: 'Empty-state hint with an add-region call-to-action when the layout has zero regions.',
    },
  ],

  telemetryEvents: [
    {
      eventName: 'authoring.page-editor.structure-grid.region-added',
      trigger: 'add-region button clicked or split-region produces a new region.',
      properties: ['name', 'column', 'row', 'columnSpan', 'rowSpan', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.structure-grid.region-removed',
      trigger: 'remove-region button clicked or merge-regions removes the absorbed names.',
      properties: ['name', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.structure-grid.region-renamed',
      trigger: 'Inline rename input submitted with a non-empty unique name.',
      properties: ['from', 'to', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.structure-grid.region-split',
      trigger: 'split-region button clicked with a region selected.',
      properties: ['name', 'axis', 'at', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.structure-grid.regions-merged',
      trigger: 'merge-regions button clicked with ≥2 adjacent regions selected.',
      properties: ['names', 'into', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.structure-grid.region-selected',
      trigger: 'region-cell clicked.',
      properties: ['name', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.structure-grid.track-resized',
      trigger: 'track-resize-handle pointer-drag end with a new fractional size.',
      properties: ['axis', 'index', 'sizeFr', 'previousSizeFr', 'correlationId'],
    },
    {
      eventName: 'authoring.page-editor.structure-grid.validation-failed',
      trigger: 'Any structural intent rejected (overlap, duplicate name, empty name, indivisible region).',
      properties: ['intent', 'reason', 'correlationId'],
    },
  ],

  acceptanceScenarios: [
    {
      name: 'Adding a region appends a cell',
      given: 'Structure grid is mounted with the starter layout',
      when: 'User clicks add-region',
      then: 'A new region-cell appears at the next free grid coordinate, editor:<pageId>:structure-grid records addRegion, editor:<pageId>:shell records setLayoutTemplate with the new doc, and a region-added telemetry event fires.',
    },
    {
      name: 'Renaming a region updates the document',
      given: 'A region named "main" is selected',
      when: 'User double-clicks the region-cell, types "primary", and presses Enter',
      then: 'editor:<pageId>:structure-grid records renameRegion { from: "main", to: "primary" }, the region-cell label updates, the document\'s region key changes to "primary", and a region-renamed event fires.',
    },
    {
      name: 'Splitting a region produces two cells',
      given: 'A region is selected',
      when: 'User clicks split-region with data-axis="column"',
      then: 'The original cell becomes two adjacent region-cells of equal column-span, editor:<pageId>:structure-grid records splitRegion, and one region-added event fires for the new region.',
    },
    {
      name: 'Resizing a track via pointer drag',
      given: 'Structure grid has at least two columns',
      when: 'User pointer-drags the track-resize-handle between columns 0 and 1 by +40 CSS pixels',
      then: 'editor:<pageId>:structure-grid records resizeTrack with a new sizeFr value, the grid template-columns string updates, and one track-resized event fires on pointer-up.',
    },
    {
      name: 'Rejected rename surfaces inline validation',
      given: 'Two regions exist named "main" and "aside"',
      when: 'User attempts to rename "aside" to "main"',
      then: 'validation-message renders next to the input with reason "duplicate-name", no renameRegion commit lands, and a validation-failed event fires with intent "renameRegion".',
    },
  ],
};
