/**
 * Backend adapter entrypoint.
 *
 * Reads VITE_BACKEND env var to select the active backend:
 * - 'mock' (default) — in-memory data, no backend needed
 * - 'http' — calls the real ingress API
 *
 * Components import from here, never from mock/ or http/ directly.
 */

import { mockBackend } from './mock/index.ts';
import { httpBackend } from './http/index.ts';
import type { Backend } from './backend.ts';

const backendType: string = import.meta.env.VITE_BACKEND ?? 'mock';

export const backend: Backend =
  backendType === 'http' ? httpBackend : mockBackend;

export type { Backend, BackendEventCallback, Unsubscribe } from './backend.ts';

export {
  listPolicies,
  getPolicy,
  createPolicy,
  activatePolicy,
  archivePolicy,
} from './authz.ts';
export type { PolicyStatus, PolicySummary, PolicyDetail } from './authz.ts';
