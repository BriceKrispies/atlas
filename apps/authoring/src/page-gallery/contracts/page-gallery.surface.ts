/**
 * Surface contract: authoring.page-gallery
 *
 * The page gallery route in the authoring app. Renders one of four bundled
 * gallery seed pages through `<content-page>` (in edit mode) and lets the
 * user switch between them via a select.
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
  surfaceId: 'authoring.page-gallery',
  kind: 'page',
  route: '#/page-gallery',
  purpose:
    'Authoring-app route that renders bundled gallery seed pages via `<content-page>` so authors can browse layouts side by side.',

  auth: {
    required: false,
    roles: [],
    permissions: [],
  },

  states: {
    loading: {
      applies: false,
      description: 'Seed pages are bundled JSON — mount is synchronous.',
      testId: 'authoring.page-gallery.state-loading',
      rationale: 'No async fetch.',
    },
    empty: {
      applies: false,
      description: 'Bundle always ships at least one gallery seed.',
      testId: 'authoring.page-gallery.state-empty',
      rationale: 'Bundled gallery seeds are always non-empty.',
    },
    success: {
      applies: true,
      description: 'Picker plus mounted `<content-page>` for the active gallery seed.',
      testId: 'authoring.page-gallery.state-success',
    },
    validationError: {
      applies: false,
      description: 'No form at the route level.',
      testId: 'authoring.page-gallery.state-validation-error',
      rationale: 'Route is a viewer/picker, not a form.',
    },
    backendError: {
      applies: false,
      description: 'No backend — pages render from the in-memory authoring page store.',
      testId: 'authoring.page-gallery.state-error',
      rationale: 'No HTTP calls.',
    },
    unauthorized: {
      applies: false,
      description: 'Authoring tool is unauthenticated.',
      testId: 'authoring.page-gallery.state-unauthorized',
      rationale: 'No auth requirement.',
    },
  },

  elements: [
    {
      name: 'page-select',
      type: 'atlas-select',
      testId: 'authoring.page-gallery.page-select',
      purpose: 'Switch the active gallery seed page',
    },
  ],

  telemetryEvents: [],

  acceptanceScenarios: [
    {
      name: 'Route mounts with the first gallery seed',
      given: 'User has loaded the authoring app',
      when: 'User navigates to #/page-gallery',
      then: 'Picker is visible and a `<content-page>` is mounted for the first gallery seed',
    },
    {
      name: 'Switching seeds remounts the page',
      given: 'Page gallery is mounted on the default seed',
      when: 'User selects a different gallery seed in the picker',
      then: 'A new `<content-page>` is mounted bound to the chosen seed',
    },
  ],
};
