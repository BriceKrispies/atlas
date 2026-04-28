import type { IngressState } from './submit-intent.ts';

export interface InterceptorOptions {
  state: IngressState;
  apiPrefix?: string;
}

/**
 * @stub
 * Not yet load-bearing. The browser-sim wires submitIntent + the catalog
 * query router directly today; nothing actually monkey-patches `fetch`.
 * This export reserves the call shape so the eventual interceptor can land
 * without import-site churn. Returns a no-op uninstaller.
 *
 * @todo Implement real fetch interception (matches `apiPrefix`, dispatches
 *       to submitIntent / query router, returns a Response).
 */
export function installFetchInterceptor(_opts: InterceptorOptions): () => void {
  return () => {
    // no-op uninstaller
  };
}
