/**
 * Host-operation set for the expression DSL.
 *
 * ALL pure (ADR 0007 §6 pure category). Expression DSL stays fully pure
 * by construction — there is no effectful op that crosses a port boundary.
 * The escape hatches for tenant-data lookup (`lookup`) and function
 * invocation (`function(name, args)`) belong to the template / query
 * DSLs, where the value of a port hop is clear.
 *
 * The set is intentionally small for v1: `upper`, `lower`, `trim`, `len`,
 * `format`, `escape`, `now`, `coalesce`. Adding ops is a spec change.
 *
 * Liskov: every op conforms to `HostOpDef`. The registry is constructed
 * once and frozen at construction time. Consumers walk `.list()` to
 * introspect; per-op invocation uses the typed `ops` map.
 */

import type {
  HostOpContext,
  HostOpDef,
  HostOpError,
  HostOpRegistry,
  HostOpSet,
  Result,
} from '@atlas/dsl-substrate';

type ScalarValue = string | number | boolean | null;

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}
function fail(opName: string, reason: string, cause?: unknown): { ok: false; error: HostOpError } {
  return {
    ok: false,
    error: { opName, reason, ...(cause !== undefined ? { cause } : {}) },
  };
}

/**
 * Coerce a value to its canonical string form. Used by `upper`, `lower`,
 * `trim`, `format`, `escape`. The expression DSL value space is scalar;
 * everything coerces to a JSON-y string.
 */
function asString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Defensive — host scope may surface objects via dot-paths even though
  // the grammar can't produce them. Stringify rather than throw.
  return JSON.stringify(v);
}

const upperOp: HostOpDef<readonly [unknown], string> = {
  name: 'upper',
  category: 'pure',
  port: null,
  invoke: async (args): Promise<Result<string, HostOpError>> => ok(asString(args[0]).toUpperCase()),
};

const lowerOp: HostOpDef<readonly [unknown], string> = {
  name: 'lower',
  category: 'pure',
  port: null,
  invoke: async (args): Promise<Result<string, HostOpError>> => ok(asString(args[0]).toLowerCase()),
};

const trimOp: HostOpDef<readonly [unknown], string> = {
  name: 'trim',
  category: 'pure',
  port: null,
  invoke: async (args): Promise<Result<string, HostOpError>> => ok(asString(args[0]).trim()),
};

const lenOp: HostOpDef<readonly [unknown], number> = {
  name: 'len',
  category: 'pure',
  port: null,
  invoke: async (args): Promise<Result<number, HostOpError>> => {
    const v = args[0];
    if (typeof v === 'string') return ok(v.length);
    if (Array.isArray(v)) return ok(v.length);
    return ok(asString(v).length);
  },
};

const escapeOp: HostOpDef<readonly [unknown], string> = {
  name: 'escape',
  category: 'pure',
  port: null,
  invoke: async (args): Promise<Result<string, HostOpError>> => {
    const s = asString(args[0]);
    return ok(
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    );
  },
};

const coalesceOp: HostOpDef<ReadonlyArray<unknown>, ScalarValue> = {
  name: 'coalesce',
  category: 'pure',
  port: null,
  invoke: async (args): Promise<Result<ScalarValue, HostOpError>> => {
    for (const v of args) {
      if (v !== null && v !== undefined && v !== '') {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return ok(v);
        return ok(asString(v));
      }
    }
    return ok(null);
  },
};

/**
 * `now()` reads the host-supplied frozen timestamp from `ctx.frozenNow`.
 * Returns the ISO-8601 string so two evaluations of the same artifact
 * within the same intent see the same value — the determinism property
 * (ADR 0007 §2 property 4) holds.
 */
const nowOp: HostOpDef<readonly [], string> = {
  name: 'now',
  category: 'pure',
  port: null,
  invoke: async (_args, ctx: HostOpContext): Promise<Result<string, HostOpError>> =>
    ok(ctx.frozenNow),
};

/**
 * Minimal printf-style format. Supports `%s` (string) and `%d` (number)
 * positional substitutions. Args are converted via `asString`. More
 * sophisticated formatting (locale, precision) is deferred to a future
 * slice or a host-supplied richer format DSL.
 */
const formatOp: HostOpDef<ReadonlyArray<unknown>, string> = {
  name: 'format',
  category: 'pure',
  port: null,
  invoke: async (args): Promise<Result<string, HostOpError>> => {
    const template = args[0];
    if (typeof template !== 'string')
      return fail('format', 'first argument must be a string template');
    let out = '';
    let argIdx = 1;
    for (let i = 0; i < template.length; i += 1) {
      const ch = template[i];
      if (ch === '%') {
        const spec = template[i + 1];
        if (spec === 's' || spec === 'd') {
          const v = args[argIdx];
          argIdx += 1;
          out += asString(v);
          i += 1; // consume spec char
        } else if (spec === '%') {
          out += '%';
          i += 1;
        } else {
          out += ch;
        }
      } else {
        out += ch ?? '';
      }
    }
    return ok(out);
  },
};

/**
 * The closed `ExprOps` set. New ops require updating this map AND the
 * spec for the expression-DSL capability (ADR 0007 §6 closed-set
 * property).
 */
export interface ExprOps extends HostOpSet {
  readonly upper: typeof upperOp;
  readonly lower: typeof lowerOp;
  readonly trim: typeof trimOp;
  readonly len: typeof lenOp;
  readonly escape: typeof escapeOp;
  readonly coalesce: typeof coalesceOp;
  readonly now: typeof nowOp;
  readonly format: typeof formatOp;
}

const ALL_OPS = {
  upper: upperOp,
  lower: lowerOp,
  trim: trimOp,
  len: lenOp,
  escape: escapeOp,
  coalesce: coalesceOp,
  now: nowOp,
  format: formatOp,
} as const satisfies ExprOps;

/**
 * Build the typed host-op registry for the expression DSL. The registry
 * is the same shape every time (no per-tenant variation in v1).
 */
export function makeExpressionRegistry(): HostOpRegistry<ExprOps> {
  return {
    kind: 'expression',
    ops: ALL_OPS,
    list() {
      return [
        { name: 'upper', category: 'pure' as const, port: null },
        { name: 'lower', category: 'pure' as const, port: null },
        { name: 'trim', category: 'pure' as const, port: null },
        { name: 'len', category: 'pure' as const, port: null },
        { name: 'escape', category: 'pure' as const, port: null },
        { name: 'coalesce', category: 'pure' as const, port: null },
        { name: 'now', category: 'pure' as const, port: null },
        { name: 'format', category: 'pure' as const, port: null },
      ];
    },
  };
}

/**
 * The default `HostOpContext` for stand-alone evaluation (no real tenant
 * scope). Mostly used by tests and the conformance suite. Real evaluation
 * (inside a request) gets a tenant-scoped context from the caller.
 */
export function makeDefaultHostContext(frozenNowIso?: string): HostOpContext {
  return {
    tenantId: 'unknown-tenant',
    correlationId: `expr-${Math.random().toString(36).slice(2, 10)}`,
    frozenNow: frozenNowIso ?? new Date(0).toISOString(),
  };
}
