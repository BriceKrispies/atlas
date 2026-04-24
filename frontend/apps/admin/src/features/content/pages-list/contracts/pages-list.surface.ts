/**
 * Surface contract: admin.content.pages-list
 *
 * List all content pages for the current tenant with search and CRUD actions.
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
  surfaceId: 'admin.content.pages-list',
  kind: 'page',
  route: '/admin/content/pages',
  purpose: 'List all content pages for the current tenant with search, sort, and CRUD actions.',

  auth: {
    required: true,
    roles: ['tenant-admin'],
    permissions: ['Content.Page.List'],
  },

  states: {
    loading: {
      description: 'Skeleton table with 5 placeholder rows',
      testId: 'admin.content.pages-list.state-loading',
    },
    empty: {
      description: 'Empty state with "No pages yet" heading and create button',
      testId: 'admin.content.pages-list.state-empty',
    },
    success: {
      description: 'Table of pages with title, slug, status, and updated date',
      testId: 'admin.content.pages-list.state-success',
    },
    backendError: {
      description: 'Error panel with message and retry button',
      testId: 'admin.content.pages-list.state-error',
    },
  },

  elements: [
    { name: 'create-button', type: 'atlas-button', testId: 'admin.content.pages-list.create-button' },
    { name: 'skeleton', type: 'atlas-skeleton', testId: 'admin.content.pages-list.skeleton' },
    { name: 'retry-button', type: 'atlas-button', testId: 'admin.content.pages-list.retry-button' },
    {
      name: 'table',
      type: 'atlas-data-table',
      testId: 'admin.content.pages-list.table',
      includes: '@atlas/widgets atlas-data-table.widget',
    },
    { name: 'table-toolbar', type: 'atlas-table-toolbar', testId: 'admin.content.pages-list.table-toolbar' },
    { name: 'table-pagination', type: 'atlas-pagination', testId: 'admin.content.pages-list.table-pagination' },
    { name: 'row-delete', type: 'atlas-button', testId: 'admin.content.pages-list.row-delete' },
  ],

  intents: [
    { intentId: 'Content.Page.Create', trigger: 'Submit create page form', endpoint: '/intents', method: 'POST' },
    { intentId: 'Content.Page.Delete', trigger: 'Confirm delete', endpoint: '/intents', method: 'POST' },
  ],

  telemetryEvents: [
    { eventName: 'admin.content.pages-list.page-viewed', trigger: 'Page mount', properties: [] },
    { eventName: 'admin.content.pages-list.create-clicked', trigger: 'Create button clicked', properties: [] },
    { eventName: 'admin.content.pages-list.row-delete-clicked', trigger: 'Delete clicked on row', properties: ['pageId'] },
  ],

  channelEvents: [
    { eventType: 'projection.updated', transport: 'sse', reaction: 'Refresh pages list' },
  ],
};
