/**
 * Backend singleton.
 *
 * Lives in its own file so the typed wrappers (`authz.ts`,
 * `content-pages.ts`, …) can import `backend` without going through the
 * package barrel — the barrel re-exports those wrappers, which would form
 * a static-import cycle if they reached back into `index.ts` for the
 * singleton. Public consumers still see `backend` re-exported from
 * `index.ts`; that's just a re-export, not the canonical home.
 */

import { mockBackend } from './mock/index.ts';
import { httpBackend } from './http/index.ts';
import type { Backend } from './backend.ts';

const backendType: string = import.meta.env.VITE_BACKEND ?? 'mock';

export const backend: Backend =
  backendType === 'http' ? httpBackend : mockBackend;
