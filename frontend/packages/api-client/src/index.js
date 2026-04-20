/**
 * Backend adapter entrypoint.
 *
 * Reads VITE_BACKEND env var to select the active backend:
 * - 'mock' (default) — in-memory data, no backend needed
 * - 'http' — calls the real ingress API
 *
 * Components import from here, never from mock/ or http/ directly.
 */

import { mockBackend } from './mock/index.js';
import { httpBackend } from './http/index.js';

const backendType = import.meta.env.VITE_BACKEND ?? 'mock';

/** @type {import('./backend.js').Backend} */
export const backend =
  backendType === 'http' ? httpBackend : mockBackend;
