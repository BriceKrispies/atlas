// Ambient module declarations for Vite-handled asset imports.
// These let tsgo resolve imports that Vite rewrites at build/dev time.

declare module '*.css' {
  const css: string;
  export default css;
}

declare module '*.css?inline' {
  const css: string;
  export default css;
}

declare module '*.css?url' {
  const url: string;
  export default url;
}

declare module '*?url' {
  const url: string;
  export default url;
}

declare module '*?inline' {
  const content: string;
  export default content;
}

declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*?worker' {
  const WorkerCtor: new () => Worker;
  export default WorkerCtor;
}

// Vite env typing. Mirrors `vite/client` but defined locally so tsgo
// does not need to resolve `vite` from the workspace root.
interface ImportMetaEnv {
  readonly BASE_URL?: string;
  readonly MODE?: string;
  readonly DEV?: boolean;
  readonly PROD?: boolean;
  readonly SSR?: boolean;
  readonly VITE_API_URL?: string;
  readonly VITE_TENANT_ID?: string;
  readonly VITE_BACKEND?: 'http' | 'mock' | string;
  readonly VITE_BASE?: string;
  readonly [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  readonly url: string;
}
