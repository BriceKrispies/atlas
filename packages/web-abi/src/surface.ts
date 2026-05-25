/**
 * Surface introspection wire shapes (ADR 0017, specs/frontend/surface-introspection.md, I18).
 *
 * `@atlas/web-kernel`'s SurfaceRegistry produces `SurfaceSnapshot` at runtime
 * (prod-safe, authz-gated); the surface registry endpoint returns
 * `SurfaceManifest` per surface. Both shapes are shared so an agent enumerating
 * surfaces and the kernel producing them agree on the contract.
 */

export type SurfaceKind = 'page' | 'widget' | 'dialog';

export type SurfaceStateKind =
  | 'loading'
  | 'empty'
  | 'success'
  | 'error'
  | 'unauthorized';

export interface SurfaceState {
  kind: SurfaceStateKind;
  message?: string;
  code?: string;
}

export interface SurfaceDataSchema {
  kind: 'static' | 'tenant-defined';
  schemaRef: string;
}

export interface SurfaceAction {
  actionId: string;
  label: string;
  /** Shape of the parameters this action accepts (schema ref or inline). */
  parameterShape?: unknown;
  /** Whether the calling principal is permitted this action (authz-gated). */
  authzAllowed: boolean;
}

/** A live, authz-gated readout of one mounted surface. */
export interface SurfaceSnapshot {
  surfaceId: string;
  kind: SurfaceKind;
  state: SurfaceState;
  dataSchema: SurfaceDataSchema;
  data: unknown;
  actions: readonly SurfaceAction[];
  /** Authz scope hash — the snapshot reflects what this principal may see. */
  principalScope: string;
  snapshotAt: string;
}

/** The build-time-derived catalog entry for a surface (the closed registry set). */
export interface SurfaceManifest {
  surfaceId: string;
  kind: SurfaceKind;
  route?: string;
  purpose: string;
  states: readonly SurfaceStateKind[];
  actionIds: readonly string[];
  dataSchema: SurfaceDataSchema;
  introspectionPath: string;
  contractRef: string;
}
