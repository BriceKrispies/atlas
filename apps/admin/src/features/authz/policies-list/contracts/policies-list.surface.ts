/**
 * Surface contract: admin.authz.policies-list
 *
 * Versioned table of Cedar policy bundles for the current tenant. Lets a
 * tenant admin view, activate, archive, and diff policy versions.
 */

export interface SurfaceAuth {
  required: boolean;
  roles: readonly string[];
  permissions: readonly string[];
}

export interface SurfaceStateSpec {
  description: string;
  testId: string;
}

export interface SurfaceElementSpec {
  name: string;
  type: string;
  testId: string;
  includes?: string;
  parameterized?: boolean;
}

export interface SurfaceIntentSpec {
  intentId: string;
  trigger: string;
  endpoint: string;
  method: string;
}

export interface SurfaceTelemetryEventSpec {
  eventName: string;
  trigger: string;
  properties: readonly string[];
}

export interface SurfaceChannelEventSpec {
  eventType: string;
  transport: string;
  reaction: string;
}

export interface SurfaceContract {
  surfaceId: string;
  kind: 'page' | 'widget' | 'dialog';
  route: string;
  purpose: string;
  auth: SurfaceAuth;
  states: Record<string, SurfaceStateSpec>;
  elements: readonly SurfaceElementSpec[];
  intents: readonly SurfaceIntentSpec[];
  telemetryEvents: readonly SurfaceTelemetryEventSpec[];
  channelEvents: readonly SurfaceChannelEventSpec[];
}

export const contract: SurfaceContract = {
  surfaceId: 'admin.authz.policies-list',
  kind: 'page',
  route: '/admin/authz/policies',
  purpose:
    'List versioned Cedar policy bundles for the tenant; allow activate, archive, diff, view.',

  auth: {
    required: true,
    roles: ['tenant-admin'],
    permissions: ['Authz.Policy.List'],
  },

  states: {
    loading: {
      description: 'Skeleton table with placeholder rows while versions load',
      testId: 'admin.authz.policies-list.state-loading',
    },
    empty: {
      description:
        'Empty state explaining that the tenant has no policy versions; the engine falls back to allow-all-with-tenant-scope until one is authored.',
      testId: 'admin.authz.policies-list.state-empty',
    },
    success: {
      description:
        'Table of policy versions with version, status, description, lastModifiedAt, lastModifiedBy.',
      testId: 'admin.authz.policies-list.state-success',
    },
    validationError: {
      description:
        'Inline alert on the toolbar when a row action returns 400 — e.g., archive refused (last active).',
      testId: 'admin.authz.policies-list.state-validation-error',
    },
    backendError: {
      description: 'Error panel with message and retry button',
      testId: 'admin.authz.policies-list.state-error',
    },
    unauthorized: {
      description: 'Permission-denied panel with link back to the dashboard',
      testId: 'admin.authz.policies-list.state-unauthorized',
    },
  },

  elements: [
    {
      name: 'create-button',
      type: 'atlas-button',
      testId: 'admin.authz.policies-list.create-button',
    },
    { name: 'table', type: 'atlas-table', testId: 'admin.authz.policies-list.table' },
    {
      name: 'row',
      type: 'atlas-row',
      testId: 'admin.authz.policies-list.row',
      parameterized: true,
    },
    {
      name: 'row-view',
      type: 'atlas-button',
      testId: 'admin.authz.policies-list.row-view',
      parameterized: true,
    },
    {
      name: 'row-activate',
      type: 'atlas-button',
      testId: 'admin.authz.policies-list.row-activate',
      parameterized: true,
    },
    {
      name: 'row-archive',
      type: 'atlas-button',
      testId: 'admin.authz.policies-list.row-archive',
      parameterized: true,
    },
    {
      name: 'row-diff',
      type: 'atlas-button',
      testId: 'admin.authz.policies-list.row-diff',
      parameterized: true,
    },
    { name: 'retry-button', type: 'atlas-button', testId: 'admin.authz.policies-list.retry-button' },
  ],

  intents: [
    {
      intentId: 'Authz.Policy.Activate',
      trigger: 'Activate row clicked',
      endpoint: '/intents',
      method: 'POST',
    },
    {
      intentId: 'Authz.Policy.Archive',
      trigger: 'Archive row clicked',
      endpoint: '/intents',
      method: 'POST',
    },
  ],

  telemetryEvents: [
    {
      eventName: 'admin.authz.policies-list.page-viewed',
      trigger: 'Page mount',
      properties: [],
    },
    {
      eventName: 'admin.authz.policies-list.create-clicked',
      trigger: 'New policy button clicked',
      properties: [],
    },
    {
      eventName: 'admin.authz.policies-list.row-activate-clicked',
      trigger: 'Activate clicked on a row',
      properties: ['version'],
    },
    {
      eventName: 'admin.authz.policies-list.row-archive-clicked',
      trigger: 'Archive clicked on a row',
      properties: ['version'],
    },
    {
      eventName: 'admin.authz.policies-list.row-diff-clicked',
      trigger: 'Diff clicked on a row',
      properties: ['version'],
    },
  ],

  // SSE-driven live refresh is deferred to v2 — wiring requires
  // server-side dispatch of `projection.updated` events for the Policy
  // resource, which the current dispatcher does not yet emit. The
  // contract stays honest: empty until the subscription actually fires.
  channelEvents: [],
};
