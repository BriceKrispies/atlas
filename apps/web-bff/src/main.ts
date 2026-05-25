// apps/web-bff — Ring bff (frontend stack). The "frontend kernel" server:
// an always-on, trusted EDGE between the browser and apps/server's ingress.
// Serves the SPA, owns the UI intent+query contract, mediates browser<->backend,
// and reaches the domain ONLY via apps/server's HTTP ingress. Imports no
// @atlas/* except @atlas/web-abi — its domain-free property is matrix-proven
// (ADR 0017 §4). The Hono process lands in PR6; this is the scaffold.
export {};
