# Atlas Streaming I/O — Contract

The contract for the places in Atlas where data flows through the runtime as a
**stream** — byte-sized, chunk-shaped, or event-shaped — rather than as a
discrete request/response. Naming where streaming is load-bearing, what
substrate carries it, what invariants it MUST preserve, and where streams are
the wrong tool.

This spec is normative (RFC 2119). It is the operator's and developer's
contract for "when should this be a stream?" — and, just as importantly, when
it should not be.

Streaming I/O is **not** a kernel reshape. The instruction set
([`runtime-instruction-set.md`](runtime-instruction-set.md)) is unchanged; the
kernel/data discipline ([`kernel-vs-data.md`](kernel-vs-data.md)) is unchanged;
the two catch-alls ([`action-driven-routing.md`](action-driven-routing.md)) are
unchanged. Streaming is a **content-type variant** on the existing two
catch-alls plus a small set of internal pipelines. The kernel's request
lifecycle is RPC-shaped (PIPE-CMD-001, PIPE-QRY-001) and stays that way.

---

## §1 Why this spec exists

Atlas has seven concrete sites where data MUST flow as a stream because the
payload is too large to buffer, or the consumer wants per-chunk progress, or
the producer emits over time:

1. **Tarball upload** — `code/repository/upload-tarball` ingests multi-GB
   tenant source archives. Buffering them in memory is a denial-of-service in
   one request.
2. **Image-build logs** — `compute/image-build` invokes kaniko out-of-process;
   kaniko emits a continuous log stream during the build (often minutes long).
   Callers (`atlasctl push --follow`, the build-status surface) need real-time
   progress, not a final-status snapshot.
3. **Function invocation logs** — `runFunction` ([instruction
   set](runtime-instruction-set.md#runfunction)) runs tenant code in a gVisor
   pod out-of-process per [ADR
   0006](../decisions/0006-function-runtime-substrate.md). Stdout/stderr come
   back as a stream the tenant tails for debugging.
4. **Surface state subscriptions** — `renderSurface` ([instruction
   set](runtime-instruction-set.md#rendersurface)) today returns a point-in-time
   snapshot. The agentic-first tenet ([`vision.md`](../vision.md)) is sharper
   when an agent (or a BDD harness) holds an open subscription to a surface's
   state machine and reacts to transitions instead of polling.
5. **Event tail** — `apps/projection-worker`'s consumption of the event log is
   conceptually a stream; the current poll-shaped `WorkerSource` is a defensible
   first cut but `LISTEN/NOTIFY` → `Readable` is the load-bearing form.
6. **Audit pipe-out** — high-volume operators want audit events shipped
   continuously to their SIEM. A poll-shaped export is the wrong shape; an
   authenticated, tenant-scoped stream sink is the right one.
7. **Import-export bulk paths** — `import-export` domain moves bulk data in
   and out. Streaming is the only shape that scales.

The seven sites have enough in common — tenant scoping, correlation, authz
gating, backpressure semantics, quota debiting, audit emission — that a single
contract is cheaper than seven domain-local conventions that drift. This spec
is that contract.

---

## §2 Substrate

### §2.1 Two substrates, one interop boundary

- **Web Streams (`ReadableStream` / `WritableStream` / `TransformStream`)** —
  the canonical shape at the HTTP boundary. Hono's `request.body` is a
  `ReadableStream`; Hono's `c.body(stream)` accepts one back. Web Streams are
  the lingua franca for I1 traffic.
- **Node Streams (`Readable` / `Writable` / `Transform` / `Duplex`) and async
  iterators** — the canonical shape inside the runtime. Modules and ports
  expose Node Streams (or `AsyncIterable<T>` for typed event streams) because
  the Node API has richer error handling, mature backpressure, and direct
  interop with the rest of the Node ecosystem (`fs.createReadStream`,
  `child_process.stdout`, `tar`, `zlib`, etc.).

The interop boundary is `Readable.fromWeb` / `Readable.toWeb` at the HTTP
edge. The catch-alls in `apps/server` perform the conversion exactly once per
request. Modules MUST NOT see Web Streams; ports MUST NOT expose Web Streams.

### §2.2 Where each lives in the codebase

- **Web Streams**: only in `apps/server/src/routes/*` and the catch-alls. The
  conversion to Node Streams happens before the request crosses into ingress
  middleware.
- **Node Streams / async iterators**: ports under `ports/`, module handlers
  under `modules/*/src/`, and adapter implementations under `adapters/*/src/`.
- **Adapter substrate**: an adapter MAY internally use whatever the underlying
  library exposes (a gRPC stream, an S3 multipart upload, a Postgres
  `LISTEN/NOTIFY` socket, a `child_process.spawn` stdout pipe). The port surface
  is always Node Streams or `AsyncIterable<T>`.

---

## §3 Shape on the wire

Streams cross the I1 boundary as one of three content-types, declared by the
caller and honored by the catch-all:

### §3.1 `application/x-tar` (or any opaque binary) — request body

Used by intent-side streaming uploads. The caller `POST`s to
`/api/v1/intents` with `Content-Type` naming the payload shape; the
`IntentEnvelope` JSON is sent first as a multipart prologue or as a header
sidecar (the per-action upload contract names which). The handler reads the
remainder of the body as a Node `Readable` and pipes into its processing
pipeline.

The intent catch-all does NOT buffer the body. The ingress pipeline runs
(authn, tenant resolve, authz, quota, idempotency) **before** the body is
read; the handler receives an unbuffered `Readable` and is responsible for
backpressure on the consumer side.

### §3.2 `text/event-stream` (SSE) — response body

Used by query-side streaming reads — surface subscriptions, build-log tails,
function-log tails, audit pipe-out. The caller adds `Accept: text/event-stream`
to a `GET /api/v1/queries/:queryId` and the catch-all opens an SSE response.

Each SSE event MUST carry:

- `event:` — the event name (e.g., `Surface.StateChanged`, `Build.LogLine`,
  `Audit.EventRecorded`).
- `id:` — a monotonic per-stream cursor (the offset the client can resume from
  on reconnect).
- `data:` — a single line of JSON.

The catch-all owns SSE framing, heartbeat (a `:keepalive` comment every 30s),
and reconnection cursor (`Last-Event-ID` header). Query functions return an
`AsyncIterable<StreamEvent>`; the catch-all serializes it.

### §3.3 `application/x-ndjson` — response body

Used by bulk-export query paths where SSE framing is unwanted overhead. One
JSON document per line; no event metadata; intended for batch consumers
(`atlasctl audit export`, a one-shot SIEM backfill).

The catch-all selects framing based on `Accept`:

- `Accept: text/event-stream` → SSE.
- `Accept: application/x-ndjson` → NDJSON.
- `Accept: application/json` (or absent) → buffered JSON (the existing
  non-streaming path).

A query descriptor declares which framings it supports; an unsupported
`Accept` yields `406 Not Acceptable`.

---

## §4 Shared invariants

Every stream that crosses the I1 boundary MUST satisfy:

- **I1** — streams enter and leave only through `apps/server`. Tenant code
  produces a stream only via the `FunctionRuntime` port; the substrate (kaniko,
  k3s pod stdio, etc.) produces a stream only inside an adapter. No module or
  package may open an HTTP listener of its own to serve a stream.
- **I2** — authorization runs **before** the stream opens. The catch-all
  evaluates the policy decision on the descriptor's `actionId` against the
  caller's principal; on `deny`, the response is `403` with no bytes flowed.
  Authorization is **NOT** re-evaluated per chunk — Cedar evaluation per byte
  would dwarf the payload cost. If the bundle reloads mid-stream and a still-
  open subscription would now be denied, the substrate MAY close the stream at
  the next chunk boundary; it MUST NOT silently continue.
- **I5** — `correlationId` propagates as a stream-level attribute. For SSE,
  the catch-all sets `X-Atlas-Correlation-Id` on the initial response headers
  and embeds it in every emitted log line per
  [`logging.md`](logging.md). For request-body streams, the
  catch-all reads the envelope's `correlationId` once and propagates it.
- **I7** — every chunk in a stream is **for a single tenant**. Streams MUST
  NOT multiplex chunks across tenants. A bulk-export stream that fans out to
  multiple tenants opens one stream per tenant; the audit pipe-out is per-
  tenant. The audit-pipe-out for the `_platform` tenant is the only legal
  cross-tenant aggregate, and it is open only to platform principals (I2
  gates).
- **I13** — quota is enforced at stream open (the open succeeds only if the
  tenant has remaining budget on the relevant dimension) AND continuously as
  bytes flow. The substrate MUST debit `egress-bytes` (for SSE / NDJSON
  responses) or `storage-bytes` / `ingress-bytes` (for uploads) at chunk
  granularity. Over-quota mid-stream closes the stream with a `QUOTA_EXCEEDED`
  trailing event; the substrate MUST NOT buffer indefinitely against an
  exhausted budget.
- **I15** — outbound streams from tenant code (a function piping to an
  external webhook, audit-pipe-out to an operator's SIEM) traverse the egress
  port. The egress port's authz / audit / quota apply to streams uniformly with
  request/response shapes.

Backpressure is non-negotiable. Every stream substrate MUST honor the
consumer's backpressure signal (Node's `pipe` does this for free;
`AsyncIterable` consumers get it via `for await`; SSE framing relies on the
HTTP response's TCP backpressure). An adapter that drops chunks rather than
applying backpressure is a defect, not a tradeoff.

---

## §5 Per-site contracts

### §5.1 Tarball upload (`code/repository`)

- **Wire:** `POST /api/v1/intents` with `Content-Type: application/x-tar` and
  the `IntentEnvelope` carried as `X-Atlas-Intent-Envelope` JSON header.
- **Handler shape:** `(ctx, envelope, body: Readable) => Promise<EventEnvelope>`
- **Quota dimension:** `storage-bytes` (debited at chunk granularity).
- **Idempotency window:** `idempotencyKey` is checked at envelope-read time,
  before the body is consumed. A duplicate intent short-circuits with the prior
  result and the body is drained-and-discarded (never written).
- **Error shape:** any handler error closes the connection with the
  appropriate ingress error code; partial state is not retained.

### §5.2 Image-build logs (`compute/image-build`)

- **Wire:** `GET /api/v1/queries/Compute.ImageBuild.LogStream` with
  `Accept: text/event-stream`, params: `{ buildId }`.
- **Query descriptor:** declares both `application/json` (final-status
  snapshot) and `text/event-stream` (live tail).
- **Source:** the build-runtime adapter exposes `tailBuildLogs(buildId):
  AsyncIterable<BuildLogLine>` on its port; the kaniko-pod stdout is the
  underlying source.
- **Quota dimension:** `egress-bytes`.
- **Close semantics:** the stream closes when the build reaches a terminal
  state (`succeeded`, `failed`, `cancelled`); a `Build.Completed` event is the
  last SSE event before close.

### §5.3 Function invocation logs (`functions` / `workflow/function-runner`)

- **Wire:** `GET /api/v1/queries/Functions.Invocation.LogStream` with
  `Accept: text/event-stream`, params: `{ invocationId }`.
- **Source:** the `FunctionRuntime` port exposes
  `tailInvocationLogs(invocationId): AsyncIterable<FunctionLogLine>`. The
  adapter (gVisor pod) connects to the pod's stdio.
- **Quota dimension:** `egress-bytes`.
- **Authorization:** the descriptor's resource is the invocation; only the
  invoking principal (and platform admins per Cedar) can tail.

### §5.4 Surface state subscriptions (`renderSurface` extension)

- **Wire:** `GET /api/v1/queries/Surface.<Id>.State` with
  `Accept: text/event-stream`. The same descriptor that serves the snapshot
  serves the subscription; the framing selects.
- **Event shape:** `Surface.StateChanged { state, schemaRef?, data, actions[] }`
  — the same `SurfaceSnapshot` shape, emitted on every state transition the
  surface declares.
- **Source:** the surface's `getSurfaceSnapshot()` is invoked once on open;
  subsequent transitions are pushed by the surface's own emit hook (a new
  contract on `AtlasSurface` — `onStateChange(listener)` — added when this
  capability ships).
- **Quota dimension:** `egress-bytes`; subscription count cap per principal to
  protect against fan-out.

### §5.5 Event tail (`apps/projection-worker`)

- **Internal only — does not cross I1.** The projection worker reads from
  `EventLog.tail(cursor): AsyncIterable<StoredEvent>` (the renamed / extended
  `WorkerSource` port).
- **Backpressure:** the consumer's pull rate drives the adapter; the adapter
  MUST NOT push faster than the consumer reads.
- **Resumption:** the cursor is durable; reconnection resumes from the last
  committed offset (I12 — projections rebuildable from event history alone).

### §5.6 Audit pipe-out

- **Wire:** `GET /api/v1/queries/Audit.EventStream` with
  `Accept: text/event-stream` (live tail) or `Accept: application/x-ndjson`
  (batch export).
- **Source:** the audit projection's read side, scoped to the caller's tenant
  (or to the platform tenant for cross-tenant aggregate).
- **Quota dimension:** `egress-bytes`.
- **Resumption:** `Last-Event-ID` carries the audit cursor; the substrate
  resumes from there.

### §5.7 Bulk import-export

- **Wire:** `POST /api/v1/intents` for `ImportExport.*.Start` (returns
  `jobId`); `GET /api/v1/queries/ImportExport.Job.Stream` with
  `Accept: application/x-ndjson` for the streamed output.
- **Source:** the import-export domain owns the streaming export pipeline; it
  reads from projections and writes NDJSON.
- **Quota dimension:** `egress-bytes` for export; `storage-bytes` for import.

---

## §6 Where streams are the wrong tool

The kernel's request lifecycle is RPC-shaped. Do **not** rewrite the
following as streams:

- **The seven steps of PIPE-CMD-001** (`resolveTenant` → `authenticate` →
  `validate` → `authorize` → `enforceQuota` → `checkIdempotency` →
  `dispatchAction`). These are sequential synchronous decisions; a `Transform`
  wrapper adds ceremony and no capability. The shape stays as it is in
  `packages/ingress/src/submit-intent.ts`.
- **`evaluatePolicy`** — Cedar evaluation is request/response. A stream-join
  expression of policy adds latency and obscures the decision boundary.
- **`checkQuota`** — atomic decrement-or-reject (I13) does not compose with
  at-least-once stream semantics. Keep it RPC.
- **`materializeQuery` for point-in-time reads** — the cache lookup and
  projection read are microseconds. Wrapping them in a stream is a regression.
  The stream shape applies only when the consumer wants a *subscription*; the
  point-in-time path stays.

A capability that proposes to re-shape one of the above as a stream is
rejected at the architect gate. The streaming-io contract is for I/O, not
for the kernel's decision pipeline.

---

## §7 Anti-patterns

- **Mounting `/api/v1/streams/*` as a third catch-all.** Streams are a
  content-type variant of the existing two catch-alls. A third mount is a
  kernel touch ([`always-on.md` §11.1](always-on.md#§111-when-the-retrospective-fires))
  with no capability gain.
- **Buffering a stream body in memory before processing.** Tarball uploads,
  log tails, and bulk exports MUST flow chunk-at-a-time. An adapter that
  collects the whole stream before emitting is a defect.
- **Web Streams leaking past `apps/server`.** Modules and ports see Node
  Streams or `AsyncIterable<T>`. A module importing `ReadableStream` is a
  layering violation.
- **Re-evaluating Cedar per chunk.** Authorization is at stream open; bundle
  reload triggers a stream close at the next chunk boundary, not a re-evaluate.
- **Cross-tenant multiplexing on a single stream.** Each stream is for one
  tenant. The audit pipe-out for the `_platform` tenant is the only legal
  cross-tenant shape; it is platform-principal-only.
- **Silent backpressure drops.** An adapter that drops chunks under
  backpressure rather than blocking the producer is a defect, not a tradeoff.
- **Streams without quota debits.** A stream that flows bytes without
  debiting the appropriate dimension is a quota-bypass.

---

## §8 Conformance

- **Architect gate:** verifies (a) no new HTTP mount for streaming outside
  the two catch-alls; (b) every streaming endpoint declares its content-types
  in the query descriptor or per-action upload contract; (c) Web Streams do
  not appear in module or port code; (d) authz runs at stream open and is not
  per-chunk.
- **SDET adversarial pass:** asserts (a) backpressure propagates end-to-end
  on each streaming site (a slow consumer slows the producer); (b) stream
  closes with `QUOTA_EXCEEDED` when the tenant's relevant budget exhausts mid-
  stream; (c) `Last-Event-ID` resumption returns the correct cursor for SSE
  endpoints; (d) a denied stream open returns `403` with zero bytes flowed.
- **Observability gate:** the [`observability-architect`](../../.claude/agents/observability-architect.md)
  audits streaming code paths for the [`logging.md`](logging.md) contract —
  every stream open emits an `event` log with the queryId / actionId, the
  caller, the framing, and the `correlationId`; every close emits a
  terminating event with the byte count and close reason.
- **BDD scenarios** under `tests/bdd/features/streaming-io/` (created when
  the first streaming-io capability ships) exercise tarball upload, SSE
  subscription, NDJSON export, and the deny / quota-exhausted close paths.

Drift findings here become `type: drift-finding` tickets per
[`tickets/CLAUDE.md`](../../tickets/CLAUDE.md).

---

## §9 Relationship to other crosscut specs

- [`action-driven-routing.md`](action-driven-routing.md) — the two catch-alls
  this spec extends. Streaming is a content-type variant; the catch-alls'
  registration model, authz path, and parity check are unchanged.
- [`runtime-instruction-set.md`](runtime-instruction-set.md) — the ten
  instructions are unchanged. Streams are an I/O shape, not a new
  instruction.
- [`kernel-vs-data.md`](kernel-vs-data.md) — the streaming substrate (Web
  Streams interop, the `EventLog.tail` port method, the SSE / NDJSON framers
  in the catch-alls) is kernel; the per-site descriptors that declare which
  query supports which framing are data.
- [`logging.md`](logging.md) — every stream open / close / error emits a
  structured log event per the logging contract.
- [`errors.md`](errors.md) — stream close errors use the same taxonomy as
  request/response errors; a mid-stream `QUOTA_EXCEEDED` carries the same code
  and shape as an at-ingress quota rejection.
