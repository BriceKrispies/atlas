/**
 * Surface contract: authoring.page-editor
 *
 * The page editor route in the authoring app. Hosts the full-featured page
 * editor shell (`<sandbox-page-editor>`) inside an authoring route surface
 * with a seed-page picker for switching between starter / blank.
 *
 * The inner shell is its own surface (`sandbox.page-editor`) with toolbar,
 * canvas, inspector, and live-preview regions. This contract describes the
 * route-level surface; tests that need to drive the inner shell can target
 * its own surfaceId. See sandbox tests for shell-level coverage of the
 * editor itself.
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

  telemetryEvents: [],

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
