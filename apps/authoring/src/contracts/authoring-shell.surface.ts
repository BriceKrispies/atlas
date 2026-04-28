/**
 * Surface contract: authoring.shell
 *
 * The authoring app's outer shell. Provides the topbar + sidebar nav and
 * mounts the active route element in the content area, driven by hash
 * routing. Mirrors the convention in `apps/admin/src/shell/`.
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
  acceptanceScenarios: readonly SurfaceAcceptanceScenario[];
}

export const ROUTES = [
  { id: 'page-editor', label: 'Page Editor' },
  { id: 'layout-editor', label: 'Layout Editor' },
  { id: 'block-editor', label: 'Block Editor' },
  { id: 'page-gallery', label: 'Page Gallery' },
] as const;

export type AuthoringRouteId = typeof ROUTES[number]['id'];

export const contract: SurfaceContract = {
  surfaceId: 'authoring.shell',
  kind: 'page',
  route: '/',
  purpose:
    'Outer shell for the authoring app. Renders topbar, sidebar nav, and mounts the active route element from a hash route.',

  auth: {
    required: false,
    roles: [],
    permissions: [],
  },

  states: {
    loading: {
      applies: false,
      description: 'Shell is rendered synchronously on connect.',
      testId: 'authoring.shell.state-loading',
      rationale: 'No async dependencies.',
    },
    success: {
      applies: true,
      description: 'Topbar with title, sidebar with one nav item per route, and an active route element mounted in the content area.',
      testId: 'authoring.shell.state-success',
    },
    backendError: {
      applies: false,
      description: 'No backend.',
      testId: 'authoring.shell.state-error',
      rationale: 'Shell makes no API calls.',
    },
    unauthorized: {
      applies: false,
      description: 'Authoring tool is unauthenticated.',
      testId: 'authoring.shell.state-unauthorized',
      rationale: 'No auth requirement.',
    },
  },

  elements: [
    {
      name: 'route-nav',
      type: 'atlas-nav',
      testId: 'authoring.shell.route-nav',
      purpose: 'Sidebar navigation between authoring routes',
    },
  ],

  acceptanceScenarios: [
    {
      name: 'Default route loads the page editor',
      given: 'User loads the authoring app at /',
      when: 'No hash is set',
      then: 'The page-editor route element is mounted in the content area',
    },
    {
      name: 'Hash route navigation mounts the right route element',
      given: 'User loads the authoring app',
      when: 'User navigates to a #/<route> hash',
      then: 'The matching route element is mounted in the content area and the matching nav item shows aria-selected',
    },
  ],
};
