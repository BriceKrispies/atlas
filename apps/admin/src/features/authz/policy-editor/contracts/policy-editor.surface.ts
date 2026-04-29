/**
 * Surface contract: admin.authz.policy-editor
 *
 * Three-pane authoring + simulator surface for a single Cedar policy
 * version. Left pane: Cedar source in <atlas-code-editor>. Right top:
 * parsed AST in <atlas-json-view>. Right bottom: client-side simulator
 * that runs cedar-wasm/web to evaluate hand-crafted requests.
 */

import type { SurfaceContract } from '../../policies-list/contracts/policies-list.surface.ts';

export type { SurfaceContract };

export const contract: SurfaceContract = {
  surfaceId: 'admin.authz.policy-editor',
  kind: 'page',
  route: '/admin/authz/edit/:version',
  purpose:
    'Author a Cedar policy version. Real-time validation via cedar-wasm/web; client-side simulator; save creates a new draft; activate is a separate atomic action.',

  auth: {
    required: true,
    roles: ['tenant-admin'],
    permissions: ['Authz.Policy.Read', 'Authz.Policy.Create'],
  },

  states: {
    loading: {
      description: 'Skeleton three-pane layout while the version loads',
      testId: 'admin.authz.policy-editor.state-loading',
    },
    success: {
      description:
        'Three panes rendered: editor on the left, AST + simulator stacked on the right.',
      testId: 'admin.authz.policy-editor.state-success',
    },
    validationError: {
      description:
        'Cedar parse / schema validation error surfaced in an alert above the editor; save and activate disabled.',
      testId: 'admin.authz.policy-editor.state-validation-error',
    },
    backendError: {
      description: 'Save / activate failed; alert with message and retry.',
      testId: 'admin.authz.policy-editor.state-error',
    },
    unauthorized: {
      description: 'Permission denied for editing policies',
      testId: 'admin.authz.policy-editor.state-unauthorized',
    },
  },

  elements: [
    {
      name: 'cedar-editor',
      type: 'atlas-code-editor',
      testId: 'admin.authz.policy-editor.cedar-editor',
    },
    {
      name: 'ast-view',
      type: 'atlas-json-view',
      testId: 'admin.authz.policy-editor.ast-view',
    },
    {
      name: 'simulator-principal-id',
      type: 'atlas-input',
      testId: 'admin.authz.policy-editor.simulator-principal-id',
    },
    {
      name: 'simulator-action',
      type: 'atlas-input',
      testId: 'admin.authz.policy-editor.simulator-action',
    },
    {
      name: 'simulator-resource-type',
      type: 'atlas-input',
      testId: 'admin.authz.policy-editor.simulator-resource-type',
    },
    {
      name: 'simulator-resource-id',
      type: 'atlas-input',
      testId: 'admin.authz.policy-editor.simulator-resource-id',
    },
    {
      name: 'simulator-evaluate',
      type: 'atlas-button',
      testId: 'admin.authz.policy-editor.simulator-evaluate',
    },
    {
      name: 'simulator-result',
      type: 'atlas-box',
      testId: 'admin.authz.policy-editor.simulator-result',
    },
    {
      name: 'save-button',
      type: 'atlas-button',
      testId: 'admin.authz.policy-editor.save-button',
    },
    {
      name: 'activate-button',
      type: 'atlas-button',
      testId: 'admin.authz.policy-editor.activate-button',
    },
    {
      name: 'validation-alert',
      type: 'atlas-alert',
      testId: 'admin.authz.policy-editor.validation-alert',
    },
  ],

  intents: [
    {
      intentId: 'Authz.Policy.Create',
      trigger: 'Save button clicked',
      endpoint: '/intents',
      method: 'POST',
    },
    {
      intentId: 'Authz.Policy.Activate',
      trigger: 'Activate button clicked',
      endpoint: '/intents',
      method: 'POST',
    },
  ],

  telemetryEvents: [
    {
      eventName: 'admin.authz.policy-editor.page-viewed',
      trigger: 'Page mount',
      properties: ['version'],
    },
    {
      eventName: 'admin.authz.policy-editor.validated',
      trigger: 'cedar-wasm parse completes after edit',
      properties: ['ok'],
    },
    {
      eventName: 'admin.authz.policy-editor.simulator-run',
      trigger: 'Evaluate clicked in simulator',
      properties: ['decision'],
    },
    {
      eventName: 'admin.authz.policy-editor.saved',
      trigger: 'Save intent acked',
      properties: ['version'],
    },
    {
      eventName: 'admin.authz.policy-editor.activated',
      trigger: 'Activate intent acked',
      properties: ['version'],
    },
  ],

  channelEvents: [],
};
