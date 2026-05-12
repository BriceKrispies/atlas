/**
 * Guardrail diagnostics helpers — TS analogue of the Rust
 * `crates/diagnostics` `guardrail!`, `tech_debt!`, `mvp_shortcut!`
 * macros.
 *
 * A guardrail is a structured, intentional deviation from best
 * practice (technical debt, MVP shortcut, performance workaround,
 * etc.). Recording one bumps the `guardrail_hits_total` Prometheus
 * counter and emits a structured warning so it shows up in dashboards
 * and log searches.
 *
 * Field names match what the Rust `tracing::warn!(event="guardrail",
 * ...)` emits, so cross-runtime log queries stay portable:
 *   { event, kind, id, component, message, invariant?, expires?, ticket? }
 *
 * Logging contract: `guardrail()` writes via `ctx.logger.warn(...)` per
 * `specs/crosscut/logging.md`. The active logger is supplied either as
 * an explicit argument or via the per-process registry (see
 * `setGuardrailLogger`). Callers without a context can omit the
 * argument; the registry default is a no-op so nothing crashes — the
 * Prometheus counter still ticks, which is the load-bearing signal.
 *
 * Build-time enforcement note: the Rust `mvp_shortcut!` macro emits
 * `compile_error!` in release builds when the `allow_mvp_shortcuts`
 * feature is off. There is no compile-time analogue in TypeScript —
 * `mvpShortcut()` here is a pure runtime warn/log. Treat presence of
 * an `mvpShortcut` call in a production build as a lint smell, not
 * a build break.
 */

import { guardrailHitsTotal } from './atlas-metrics.ts';

export interface GuardrailOptions {
  /**
   * Guardrail family — typically `'tech_debt'`, `'mvp_shortcut'`, or
   * an arbitrary string for ad-hoc deviations (e.g. `'perf_workaround'`).
   */
  readonly kind: string;
  /** Unique identifier for this specific guardrail occurrence. */
  readonly id: string;
  /** Component / module / subsystem where the guardrail lives. */
  readonly component: string;
  /** Human-readable description of what is being deviated from and why. */
  readonly message: string;
  /** Optional condition that must remain true for this guardrail to be valid. */
  readonly invariant?: string;
  /**
   * Optional expiry — ISO date (`'2026-06-01'`), version
   * (`'v2.0.0'`), or any free-form deadline string. Matches the Rust
   * macro's stringly-typed `expires` field.
   */
  readonly expires?: string;
  /** Optional ticket / issue tracker reference. */
  readonly ticket?: string;
}

interface GuardrailLogPayload extends Record<string, unknown> {
  event: 'guardrail';
  kind: string;
  id: string;
  component: string;
  message: string;
  invariant?: string;
  expires?: string;
  ticket?: string;
}

/**
 * Minimal structural shape of `@atlas/logging`'s Logger that we need —
 * just `warn`. Kept structural so this module doesn't pull
 * `@atlas/logging` as a hard dependency (which would create a layering
 * inversion: `metrics` is a leaf used by `ingress` / `apps/server` /
 * front-end shells).
 */
export interface GuardrailLogger {
  warn(msg: string, fields?: Record<string, unknown>): void;
}

let _registryLogger: GuardrailLogger | null = null;

/**
 * Install a process-wide logger that `guardrail()` will use when no
 * explicit logger argument is passed. Boundaries (apps/server boot,
 * worker boot, front-end app boot) call this once with a logger
 * derived from a real `AtlasExecutionContext`. Pass `null` to clear.
 */
export function setGuardrailLogger(logger: GuardrailLogger | null): void {
  _registryLogger = logger;
}

/** Test helper — returns the currently-installed logger or null. */
export function getGuardrailLogger(): GuardrailLogger | null {
  return _registryLogger;
}

/**
 * Record a guardrail event. Bumps `guardrail_hits_total{kind, id,
 * component}` and writes a structured warn record via the supplied
 * `logger` (or the process-registered one — see
 * {@link setGuardrailLogger}). Replaces the previous `console.warn`
 * shortcut, which bypassed the logging contract entirely.
 *
 * Optional fields (`invariant`, `expires`, `ticket`) are only
 * included in the log payload when provided — matches the Rust
 * macro's `$(, foo: $expr)?` opt-in semantics.
 *
 * If neither an explicit logger nor a registered one is available,
 * the metric still ticks but the log line is dropped — guardrail()
 * MUST NOT throw, since callers reach for it during shortcuts and
 * we never want diagnostics to crash the hot path.
 */
export function guardrail(
  opts: GuardrailOptions,
  logger?: GuardrailLogger,
): void {
  guardrailHitsTotal().inc({
    kind: opts.kind,
    id: opts.id,
    component: opts.component,
  });

  const payload: GuardrailLogPayload = {
    event: 'guardrail',
    kind: opts.kind,
    id: opts.id,
    component: opts.component,
    message: opts.message,
  };
  if (opts.invariant !== undefined) payload.invariant = opts.invariant;
  if (opts.expires !== undefined) payload.expires = opts.expires;
  if (opts.ticket !== undefined) payload.ticket = opts.ticket;

  const sink = logger ?? _registryLogger;
  if (sink) {
    try {
      // Per `specs/crosscut/logging.md`: structured warn record on the
      // active context. Equivalent to Rust's
      // `tracing::warn!(event="guardrail", ...)`.
      sink.warn('guardrail', payload);
    } catch {
      // A broken logger must not crash a guardrail-emitting code path.
    }
  }
}

/**
 * Record a `kind: 'tech_debt'` guardrail. Convenience wrapper around
 * {@link guardrail} for marking known refactor-or-cleanup items.
 */
export function techDebt(
  opts: Omit<GuardrailOptions, 'kind'>,
  logger?: GuardrailLogger,
): void {
  guardrail({ ...opts, kind: 'tech_debt' }, logger);
}

/**
 * Record a `kind: 'mvp_shortcut'` guardrail. Convenience wrapper
 * around {@link guardrail} for temporary implementations that must
 * be replaced before broad rollout.
 *
 * Unlike the Rust `mvp_shortcut!` macro, this does NOT fail the
 * build in release mode — TypeScript has no compile-time analogue
 * to Rust's `compile_error!`. Treat a leftover `mvpShortcut()` call
 * in production as a lint/review concern, not a build failure.
 */
export function mvpShortcut(
  opts: Omit<GuardrailOptions, 'kind'>,
  logger?: GuardrailLogger,
): void {
  guardrail({ ...opts, kind: 'mvp_shortcut' }, logger);
}
