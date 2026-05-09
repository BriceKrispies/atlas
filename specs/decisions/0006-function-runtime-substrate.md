# 0006 — `functions` runtime substrate: gVisor for MVP, swappable port

**Status:** Accepted (2026-05-08)
**Depends on:** [`0003-tenant-defined-data-model-pivot.md`](0003-tenant-defined-data-model-pivot.md) (revives `functions` as a load-bearing domain) and [`0004-platform-invariants-for-multi-tenant-fabric.md`](0004-platform-invariants-for-multi-tenant-fabric.md) (I14 tenant code isolation, I15 egress mediation).

## Context

ADR 0003 revived `functions` (Extensibility/tenant-authored sandboxed code) as a load-bearing domain. ADR 0004 added I14 — tenant code never executes in the `apps/server` process; it executes only via the `FunctionRuntime` port whose adapter runs out-of-process.

The 2026-05-08 multi-agent review (`compute-owner`, `architect`, `port-adapter-dev`, `sdet`) framed three substrate options:

| Substrate | Cold start | Density | Languages | Isolation strength | k8s integration |
|---|---|---|---|---|---|
| **V8 isolates** (workerd-style) | ~5ms | Highest (thousands per node) | JS / TS / WASM only | Weak against Spectre-class side channels without per-tenant process; strong against syscalls (none exposed) | None — runs in a worker pool process |
| **gVisor pods** | ~100ms | ~10x plain pods | Any language, any container | Strong — intercepts syscalls in user-space; mature on k8s via `RuntimeClass: gvisor` | Native — `RuntimeClass` admission |
| **Firecracker microVMs** | ~125ms | Lowest | Any language, any image | Strongest — hardware virtualization | Requires KVM (Hetzner CCX/CPX support it) and custom orchestration |

## Decision

**MVP substrate is gVisor.** First-class language-agnostic support; tenants can bring any container, write functions in any language, run any base image — not restricted to JavaScript. Cold-start cost (~100ms) is acceptable for the agentic-first vision where invocations are correlated with user/agent actions, not high-frequency hot paths.

**The `FunctionRuntime` port is shaped to keep substrates swappable.** Adapter choice is not baked into capability specs or tenant code:

```ts
interface FunctionRuntime {
  invoke(
    tenantId: TenantId,
    functionId: FunctionId,
    version: VersionId,
    input: unknown,
    ctx: InvocationContext  // correlationId, principalId, quota budget, deadline
  ): Promise<InvocationResult>;
  warmup?(tenantId: TenantId, functionId: FunctionId, version: VersionId): Promise<void>;
}
```

The MVP adapter is `adapter-function-runtime-gvisor` (k8s Job per invocation, `RuntimeClass: gvisor`, NetworkPolicy + ResourceQuota + LimitRange enforced at namespace, log capture via the host-provided `ctx.logger`).

**Phase 4 fast-path: V8 isolates.** When tenant workloads with HTTP-handler / lifecycle-hook profiles dominate (high-frequency, low-latency, JS-only), a parallel `adapter-function-runtime-v8-isolates` adapter lands. Function definitions declare a `runtime: 'gvisor' | 'v8-isolate'` hint at registration; the registry routes invocations to the matching adapter. The port surface stays unchanged.

**Firecracker is deferred.** Strongest isolation, but the operational cost (KVM nodes, microVM lifecycle management, cold-start higher than gVisor) doesn't pay off at MVP scale. Revisit if a tenant workload class emerges that needs hardware virtualization (e.g., regulated industries on the public reference instance). When it does, it's another adapter behind the same port.

## Constraints this imposes

The choice carries forward into capability specs and infrastructure:

1. **k3s admission controller** must enforce `RuntimeClass: gvisor` on every pod in tenant-`functions` namespaces; admission rejects pods without it. Wired at cluster-bootstrap.
2. **gVisor (`runsc`) installed on every node** capable of running tenant functions. Listed in `compute/cluster/cluster-bootstrap` capability scope (per `compute-owner`'s MVP shortlist).
3. **Function namespace per tenant**, distinct from the tenant's app-deployment namespace. Naming: `atlas-fn-<tenantId>`. Network-policied to deny everything by default; egress only via the egress-proxy port (I15).
4. **Cold-start budget is contracted**, not assumed. The `functions` HTTP-route capability spec must declare the SLO ("p95 invocation latency including cold start") tenants can rely on — gVisor's ~100ms is the floor, not a target.
5. **`FunctionRuntime` port is node-only.** The idb adapter (browser sim) does not implement function execution; it returns a fixture-backed stub. Sim is dev-only and trust falls back to the same-origin browser sandbox. Documented in `adapter-idb` parity matrix.
6. **SDET sandbox-escape harness uses the `FunctionRuntime` port surface.** Adversarial corpus runs against whatever adapter is plugged in; gVisor adapter must pass before MVP, V8 isolates adapter must pass before Phase 4.

## Consequences

**Positive:**

- Tenants can write functions in any language from day one. Atlas isn't locked to JS, which matters for the Salesforce-shaped vision (tenants bringing existing code).
- Native k8s integration — `RuntimeClass` is one admission rule, not a custom orchestrator.
- gVisor's syscall interception model gives a strong story for I14 (tenant code isolation) and I15 (egress mediation): the runtime sees every syscall and can refuse network/fs access except via the host-mediated context.
- Port shape stays substrate-agnostic. Switching to V8 isolates for hot paths or Firecracker for high-isolation workloads is an adapter swap, not a domain rewrite.

**Negative:**

- ~100ms cold-start floor. Tenants whose workloads are high-frequency JS hooks will feel this until V8 isolates land in Phase 4.
- gVisor has its own attack surface — `runsc` itself can have CVEs. Operator must keep gVisor patched; this is a real ongoing op cost.
- Density is lower than V8 isolates. Public reference instance scales horizontally on node count, not vertically on per-node tenant density. Acceptable at MVP scale; worth re-evaluating at 10k+ tenants.

**Out of scope:**

- The exact `RuntimeClass` admission rules and NetworkPolicy templates — lands in `compute/cluster/cluster-bootstrap` capability spec.
- The egress-proxy port shape (I15) — designed when its capability is scoped.
- V8 isolates adapter implementation — Phase 4 work; this ADR commits to the swap-in path, not the implementation.
- Function-definition packaging format (OCI image vs. tarball-bundle vs. inline source) — first `functions` capability spec.

## Migration

1. **This ADR (spec-only):** records the decision and port shape commitment.
2. **`compute/cluster/cluster-bootstrap`** capability spec must include gVisor installation + `RuntimeClass: gvisor` admission on tenant-fn namespaces.
3. **First `functions` capability spec** (Phase 3–4) lands the `FunctionRuntime` port in `@atlas/ports`, the gVisor adapter in `adapters/node`, and the SDET sandbox-escape harness corpus.
4. **Phase 4 follow-up:** V8 isolates adapter + the function-registration `runtime` hint.

No code changes in this PR.
