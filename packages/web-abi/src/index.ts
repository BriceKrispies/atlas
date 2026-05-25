// @atlas/web-abi — Ring web-abi (frontend stack). The pure wire-contract types
// shared by @atlas/web-kernel (browser) and apps/web-bff (server). Zero deps.
// The ONLY package both frontend kernels import — so neither imports the other.
// Per ADR 0017.

export type { JsonValue, WireError } from './json.ts';
export type {
  IntentActionPayload,
  IntentRequest,
  IntentResult,
} from './intent.ts';
export type { QueryRequest, QueryResult } from './query.ts';
export type { ChannelEvent, ChannelSubscription } from './channel.ts';
export type {
  SurfaceKind,
  SurfaceStateKind,
  SurfaceState,
  SurfaceDataSchema,
  SurfaceAction,
  SurfaceSnapshot,
  SurfaceManifest,
} from './surface.ts';
