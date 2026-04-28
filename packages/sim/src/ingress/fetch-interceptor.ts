import type { BrowserIngress } from '../index.ts';

export interface InterceptorOptions {
  ingress: BrowserIngress;
  apiPrefix?: string;
}

// Stub: a full fetch interceptor is a follow-up. Returning the call lets the
// caller wire it later without changing import sites.
export function installFetchInterceptor(_opts: InterceptorOptions): () => void {
  return () => {
    // no-op uninstaller
  };
}
