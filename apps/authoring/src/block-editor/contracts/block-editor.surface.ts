/**
 * Surface contract: authoring.block-editor
 *
 * The block editor route in the authoring app. Hosts the
 * `<atlas-block-editor>` element with two preset variants: a seeded
 * document with three blocks, and an empty document.
 *
 * Block-level interactions (insert, move, format, save) are driven through
 * the `<atlas-block-editor>` test-state registry under `editor:demo` /
 * `editor:empty`; tests use `readEditorState` / `assertCommitted` to
 * observe commits.
 */

export interface SurfaceAuth {
  required: boolean;
  roles: readonly string[];
  permissions: readonly string[];
}

export interface SurfaceStateSpec {
  description: string;
  testId: string;
  applies: boolean;
  rationale?: string;
}

export interface SurfaceElementSpec {
  name: string;
  type: string;
  testId: string;
  parameterized?: boolean;
  purpose?: string;
}

export interface SurfaceTelemetryEventSpec {
  eventName: string;
  trigger: string;
  properties: readonly string[];
}

export interface SurfaceAcceptanceScenario {
  name: string;
  given: string;
  when: string;
  then: string;
}

export interface SurfaceContract {
  surfaceId: string;
  kind: 'page' | 'widget' | 'dialog';
  route: string;
  purpose: string;
  auth: SurfaceAuth;
  states: Record<string, SurfaceStateSpec>;
  elements: readonly SurfaceElementSpec[];
  telemetryEvents: readonly SurfaceTelemetryEventSpec[];
  acceptanceScenarios: readonly SurfaceAcceptanceScenario[];
}

export const contract: SurfaceContract = {
  surfaceId: 'authoring.block-editor',
  kind: 'page',
  route: '#/block-editor',
  purpose:
    'Authoring-app route that hosts the block editor against two preset documents (seeded and empty) for exercising block-level intents.',

  auth: {
    required: false,
    roles: [],
    permissions: [],
  },

  states: {
    loading: {
      applies: false,
      description: 'No async load — variants are inline constants.',
      testId: 'authoring.block-editor.state-loading',
      rationale: 'Synchronous mount.',
    },
    empty: {
      applies: true,
      description:
        'Empty variant — `<atlas-block-editor>` mounts against an empty document for exercising the "no blocks" path.',
      testId: 'authoring.block-editor.state-empty',
    },
    success: {
      applies: true,
      description: 'Seeded variant — three blocks rendered (heading, text, list).',
      testId: 'authoring.block-editor.state-success',
    },
    validationError: {
      applies: false,
      description: 'Validation is internal to the block editor element.',
      testId: 'authoring.block-editor.state-validation-error',
      rationale: 'No form lives at the route level.',
    },
    backendError: {
      applies: false,
      description: 'No backend — saves are no-ops at this layer.',
      testId: 'authoring.block-editor.state-error',
      rationale: 'No HTTP calls.',
    },
    unauthorized: {
      applies: false,
      description: 'Authoring tool is unauthenticated.',
      testId: 'authoring.block-editor.state-unauthorized',
      rationale: 'No auth requirement.',
    },
  },

  elements: [
    {
      name: 'seeded',
      type: 'atlas-button',
      testId: 'authoring.block-editor.seeded',
      purpose: 'Switch to the seeded block document',
    },
    {
      name: 'empty',
      type: 'atlas-button',
      testId: 'authoring.block-editor.empty',
      purpose: 'Switch to the empty block document',
    },
  ],

  telemetryEvents: [],

  acceptanceScenarios: [
    {
      name: 'Route mounts with the seeded document',
      given: 'User has loaded the authoring app',
      when: 'User navigates to #/block-editor',
      then: 'The seeded button is primary, the empty button is ghost, and `<atlas-block-editor>` mounts with three seeded blocks (editor:demo state)',
    },
    {
      name: 'Switching to empty remounts the editor',
      given: 'Block editor is mounted on the seeded variant',
      when: 'User clicks the empty button',
      then: 'Editor remounts against an empty document and registers under editor:empty',
    },
  ],
};
