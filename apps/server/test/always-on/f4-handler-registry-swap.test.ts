/**
 * F4 — Handler-registry hot-swap test (revision 3 after SDET round 2).
 *
 * Probes `specs/crosscut/always-on.md` §4.2 + §7 anti-pattern + finding F4.
 *
 * Claim: handlers MUST be resolvable from a runtime-mutable registry; the
 * production `apps/server` MUST expose that registry as a top-level field;
 * routes MUST resolve handlers at dispatch time, not capture them in
 * `buildApp(state)` closures.
 *
 * Round-2 SDET findings addressed:
 *   - Critical (test #1 was shape-only): a no-op `register: () => {}` stub
 *     made the prior test green while the registry remained immutable.
 *     Replaced with a behavioral assertion — call `register('X', v2)`,
 *     then `get('X')` MUST return v2. A no-op stub now fails the
 *     post-mutation `.get()` identity check.
 *   - Source-scan in #2 didn't strip `//` line comments. Fixed.
 *   - APPSTATE_KEYS permitted three different names (handlers / handlerRegistry
 *     / kernel) — two reviewers could ship two different choices and both
 *     pass. Pinned to a single canonical name (`handlers`) per the spec
 *     §5 operator surface (`atlasctl kernel modules` enumerates modules
 *     whose handler-registry entries the kernel composes).
 *   - Added a regression guard: `composeRegistries` must not appear in
 *     `apps/server/src/middleware/state.ts` once §6 phase 2 ships the
 *     registry. Catches drift cheaply.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { catalogHandlerRegistry } from '@atlas/catalog';
import type { IntentHandler, HandlerRegistry } from '@atlas/ports';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const BOOTSTRAP_TS = join(REPO_ROOT, 'apps', 'server', 'src', 'bootstrap.ts');
const STATE_TS = join(REPO_ROOT, 'apps', 'server', 'src', 'middleware', 'state.ts');

// Pinned canonical names. The spec uses `kernel` for the KernelHandle
// (the thing passed to `register(kernel)`), and the registry of handlers
// is naturally `handlers`. Pin one; if the spec evolves, change here AND
// in the spec text in lockstep.
const CANONICAL_REGISTRY_FIELD = 'handlers';
const CANONICAL_MUTATION_METHOD = 'register';

// A real registered action — `Catalog.SeedPackage.Apply` is wired in
// modules/catalog/src/handlers/registry.ts:73. Using a real action means
// the fixture-sanity check below can verify the registry is non-empty.
const REAL_ACTION = 'Catalog.SeedPackage.Apply';

describe('F4 — handler-registry hot-swap (always-on §4.2 / I1)', function () {
  test('a real composed HandlerRegistry supports mutate-and-resolve through register()', () => {
    // BEHAVIORAL check, not shape-only. The prior revision tested only
    // that `register` was a property on the object; a no-op stub passed.
    // Now: install a v2 handler with a unique identity, immediately
    // query the registry, assert the v2 handler is what comes back.
    const reg = catalogHandlerRegistry();

    // Fixture sanity — if the registry doesn't even know about the
    // action, the v2-install test can't be meaningful.
    const original = reg.get(REAL_ACTION);
    expect(
      original,
      `fixture: catalogHandlerRegistry() must register ${REAL_ACTION} (modules/catalog/src/handlers/registry.ts)`,
    ).toBeDefined();

    // Probe the mutation method. Today it doesn't exist → test fails
    // at the `.toBeDefined()` line below with the diagnostic message.
    const registerFn = (
      reg as unknown as Record<string, ((actionId: string, h: IntentHandler) => void) | undefined>
    )[CANONICAL_MUTATION_METHOD];
    expect(
      registerFn,
      `HandlerRegistry must expose .${CANONICAL_MUTATION_METHOD}(actionId, handler) ` +
        'for hot-reload to install v(N+1) handlers (always-on §4.1). ' +
        `Today only \`.get\` exists on the composed registry.`,
    ).toBeDefined();

    const v2: IntentHandler = {
      async handle() {
        return {
          primary: {
            eventId: 'evt-v2',
            eventType: 'Test.V2',
            schemaId: 'x',
            schemaVersion: 1,
            occurredAt: '',
            tenantId: 't',
            correlationId: 'c',
            idempotencyKey: 'i',
            payload: {},
          },
          follow: [],
        };
      },
    };

    registerFn!.call(reg, REAL_ACTION, v2);

    // The load-bearing assertion: identity check after mutation. A
    // no-op `register: () => {}` stub leaves `reg.get(REAL_ACTION)`
    // returning `original`, which is NOT `v2`. The strict identity
    // (`toBe`) makes a "kinda-works" stub fail visibly.
    const after = reg.get(REAL_ACTION);
    expect(
      after,
      `After register('${REAL_ACTION}', v2), get('${REAL_ACTION}') MUST return v2. ` +
        'A no-op register stub returns the original handler — that is a violation ' +
        'of the hot-swap contract, not a satisfaction of it.',
    ).toBe(v2);
  });

  test('bootstrap.ts AppState interface declares a top-level handlers: HandlerRegistry field', () => {
    const src = readFileSync(BOOTSTRAP_TS, 'utf8');
    const m = src.match(/export interface AppState\s*\{([\s\S]*?)^\}/m);
    if (!m) {
      expect.fail(
        `Could not locate \`export interface AppState { ... }\` in ` +
          `apps/server/src/bootstrap.ts. The type may have moved — update this test ` +
          `to point at its new home.`,
      );
      return;
    }
    const body = m[1] ?? '';

    // Strip BOTH block comments (`/** */` and `/* */`) AND line comments (`//`).
    // The prior revision stripped only block comments — a commented-out
    // `// readonly handlers: HandlerRegistry;` would have matched.
    const noComments = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    // Field-name extractor matches `^  readonly <name>:` or `^  <name>:`.
    const fieldEntries = [...noComments.matchAll(/^\s*(?:readonly\s+)?(\w+)\s*([?:])\s*([^;\n]+);?/gm)]
      .map((mm) => ({ name: mm[1] ?? '', type: (mm[3] ?? '').trim() }));

    const handlersField = fieldEntries.find((f) => f.name === CANONICAL_REGISTRY_FIELD);
    expect(
      handlersField,
      `AppState must expose a top-level \`${CANONICAL_REGISTRY_FIELD}\` field. ` +
        `Today the registry is composed inside \`buildRequestBundle\` from static module ` +
        `imports — there is no mutable surface a reload could write through. ` +
        `Found AppState fields: ${fieldEntries.map((f) => f.name).join(', ')}`,
    ).toBeDefined();

    // Type check (string-level): the field's declared type SHOULD be
    // `HandlerRegistry` (or a richer kernel-handle interface that
    // extends it). A field literally typed `number` or `Map<…>` would
    // pass the name check but break hot-swap semantics. Substring
    // match is coarse — fine as a smoke check.
    expect(
      handlersField!.type,
      `AppState.${CANONICAL_REGISTRY_FIELD} type must reference HandlerRegistry; ` +
        `got: ${handlersField!.type}. ` +
        `A different type (Map, Record, etc.) breaks the hot-swap contract.`,
    ).toMatch(/HandlerRegistry/);
  });

  test('apps/server/src/middleware/state.ts does not call composeRegistries (registry comes from kernel)', () => {
    // Regression guard. Today `state.ts` calls `composeRegistries(...)`
    // to build the per-request handler set from static imports — exactly
    // the closure-capture anti-pattern §7 forbids. Once §6 phase 2 ships
    // the kernel registry, `state.ts` must resolve handlers from the
    // kernel handle (via `state.handlers`), NOT recompose them per
    // request from static imports.
    //
    // Today: composeRegistries appears at state.ts:249 → this test fails.
    // Tomorrow: state.ts reads from state.handlers → test passes.
    const src = readFileSync(STATE_TS, 'utf8');
    // Strip comments so a documentation reference doesn't trip the guard.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(
      stripped,
      `middleware/state.ts MUST NOT call composeRegistries — that's the static-import ` +
        `closure-capture pattern §7 forbids. Resolve handlers through state.${CANONICAL_REGISTRY_FIELD} instead.`,
    ).not.toMatch(/\bcomposeRegistries\s*\(/);
  });

  // The genuine F4 diagnostic. See test source for the acceptance bar.
  test.todo(
    'two-request swap — request 1 hits v1; mutate kernel.handlers; request 2 hits v2. ' +
      'Requires §6 phase 1 (action-driven routing) so the route resolves at dispatch time. ' +
      'Tracked in tickets/atlas-on-atlas/phase-1-action-routing.md (placeholder until set lands).',
  );
});
