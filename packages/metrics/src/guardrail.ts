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

interface GuardrailLogPayload {
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
 * Record a guardrail event. Bumps `guardrail_hits_total{kind, id,
 * component}` and emits a structured `console.warn` payload.
 *
 * Optional fields (`invariant`, `expires`, `ticket`) are only
 * included in the log payload when provided — matches the Rust
 * macro's `$(, foo: $expr)?` opt-in semantics.
 */
export function guardrail(opts: GuardrailOptions): void {
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

  // Equivalent to Rust's `tracing::warn!(event="guardrail", ...)`.
  // Structured single-arg JSON so log shippers can parse it.
  console.warn(payload);
}

/**
 * Record a `kind: 'tech_debt'` guardrail. Convenience wrapper around
 * {@link guardrail} for marking known refactor-or-cleanup items.
 */
export function techDebt(opts: Omit<GuardrailOptions, 'kind'>): void {
  guardrail({ ...opts, kind: 'tech_debt' });
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
export function mvpShortcut(opts: Omit<GuardrailOptions, 'kind'>): void {
  guardrail({ ...opts, kind: 'mvp_shortcut' });
}
