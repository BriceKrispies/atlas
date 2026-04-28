import type { IngressState } from './submit-intent.ts';

export interface InterceptorOptions {
  state: IngressState;
  apiPrefix?: string;
}

// Stub: a full fetch interceptor is a follow-up. Returning the call lets the
// caller wire it later without changing import sites.
export function installFetchInterceptor(_opts: InterceptorOptions): () => void {
  return () => {
    // no-op uninstaller
  };
}
