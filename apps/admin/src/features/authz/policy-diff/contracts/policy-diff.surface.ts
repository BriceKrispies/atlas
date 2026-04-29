/**
 * Surface contract: admin.authz.policy-diff
 *
 * Modal dialog opened from a row action in policies-list. Renders a
 * <atlas-diff> between two policy versions' raw Cedar text.
 */

import type { SurfaceContract } from '../../policies-list/contracts/policies-list.surface.ts';

export type { SurfaceContract };

export const contract: SurfaceContract = {
  surfaceId: 'admin.authz.policy-diff',
  kind: 'dialog',
  route: '',
  purpose:
    'Compare the raw Cedar text of two policy versions side-by-side via <atlas-diff>.',

  auth: {
    required: true,
    roles: ['tenant-admin'],
    permissions: ['Authz.Policy.Read'],
  },

  states: {
    loading: {
      description: 'Skeleton placeholder while either side fetches its policy text',
      testId: 'admin.authz.policy-diff.state-loading',
    },
    success: {
      description: 'Diff rendered between left and right policy versions',
      testId: 'admin.authz.policy-diff.state-success',
    },
    backendError: {
      description: 'Either fetch failed; show retry control',
      testId: 'admin.authz.policy-diff.state-error',
    },
    unauthorized: {
      description: 'Permission denied for reading policies',
      testId: 'admin.authz.policy-diff.state-unauthorized',
    },
  },

  elements: [
    { name: 'dialog', type: 'atlas-dialog', testId: 'admin.authz.policy-diff.dialog' },
    {
      name: 'left-version',
      type: 'atlas-input',
      testId: 'admin.authz.policy-diff.left-version',
    },
    {
      name: 'right-version',
      type: 'atlas-input',
      testId: 'admin.authz.policy-diff.right-version',
    },
    { name: 'diff', type: 'atlas-diff', testId: 'admin.authz.policy-diff.diff' },
    {
      name: 'close-button',
      type: 'atlas-button',
      testId: 'admin.authz.policy-diff.close-button',
    },
  ],

  intents: [],

  telemetryEvents: [
    {
      eventName: 'admin.authz.policy-diff.opened',
      trigger: 'Dialog mount',
      properties: ['leftVersion', 'rightVersion'],
    },
    {
      eventName: 'admin.authz.policy-diff.closed',
      trigger: 'Close clicked',
      properties: [],
    },
  ],

  channelEvents: [],
};
