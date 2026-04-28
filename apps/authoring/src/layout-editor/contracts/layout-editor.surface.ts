/**
 * Surface contract: authoring.layout-editor
 *
 * The layout editor route in the authoring app. Hosts the
 * `<atlas-layout-editor>` element with a picker to switch between a blank
 * canvas and any preset layout registered in `presetLayouts`.
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
  surfaceId: 'authoring.layout-editor',
  kind: 'page',
  route: '#/layout-editor',
  purpose:
    'Authoring-app route that hosts the layout editor with a picker for blank canvas or a preset layout document.',

  auth: {
    required: false,
    roles: [],
    permissions: [],
  },

  states: {
    loading: {
      applies: false,
      description:
        'Layout documents are pulled from an in-memory registry; mount is synchronous.',
      testId: 'authoring.layout-editor.state-loading',
      rationale: 'No async fetch.',
    },
    empty: {
      applies: true,
      description:
        'Blank-canvas state shown when the picker is set to "Blank canvas" — an empty layout document is seeded for editing.',
      testId: 'authoring.layout-editor.state-empty',
    },
    success: {
      applies: true,
      description: 'Picker plus mounted `<atlas-layout-editor>` against the chosen preset.',
      testId: 'authoring.layout-editor.state-success',
    },
    validationError: {
      applies: false,
      description:
        'Validation runs inside `ValidatingLayoutStore.save`; the route does not expose form-level validation.',
      testId: 'authoring.layout-editor.state-validation-error',
      rationale: 'Form-level validation lives inside the layout editor element itself.',
    },
    backendError: {
      applies: false,
      description: 'No backend — the route uses an in-memory layout store.',
      testId: 'authoring.layout-editor.state-error',
      rationale: 'No HTTP calls.',
    },
    unauthorized: {
      applies: false,
      description: 'Authoring tool is unauthenticated.',
      testId: 'authoring.layout-editor.state-unauthorized',
      rationale: 'No auth requirement.',
    },
  },

  elements: [
    {
      name: 'layout-select',
      type: 'atlas-select',
      testId: 'authoring.layout-editor.layout-select',
      purpose: 'Switch between blank canvas and preset layouts',
    },
  ],

  telemetryEvents: [],

  acceptanceScenarios: [
    {
      name: 'Route mounts with blank canvas',
      given: 'User has loaded the authoring app',
      when: 'User navigates to #/layout-editor',
      then: 'Picker is visible, defaults to the first option, and an `<atlas-layout-editor>` is mounted',
    },
    {
      name: 'Switching to a preset remounts the editor',
      given: 'Layout editor is mounted on the default option',
      when: 'User selects a different layout in the picker',
      then: 'Editor remounts against the selected preset layout',
    },
  ],
};
