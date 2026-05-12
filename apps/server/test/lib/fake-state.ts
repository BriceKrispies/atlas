/**
 * Backward-compatible re-export shim for the historical `fake-state.ts`
 * helpers used by `apps/server/test/routes/intents.test.ts` and friends.
 *
 * The actual implementations now live in `./factories.ts` (typed-factory
 * module — see header there). This file keeps the old import paths
 * working so unrelated tests don't churn while still funnelling all
 * test-double construction through the typed factories.
 *
 * New tests should import from `./factories.ts` directly.
 */

export {
  // Composite scaffolding (server-specific).
  buildFakeAppState,
  buildFakeBundle,
  attachTestPrincipalMiddleware,
  // Validators / registry.
  makeValidator,
  makeRegistry,
  // Policy stubs.
  StubAllowEngine,
  StubDenyEngine,
  // Port factories (re-exported for tests that want to compose their own
  // IngressState rather than going through buildFakeBundle).
  makeFakeCache,
  makeFakeCatalogState,
  makeFakeEntityStore,
  makeFakeEventStore,
  makeFakeProjections,
  makeFakeRelationStore,
  makeFakeSearch,
} from './factories.ts';

export type {
  FakeAppState,
  FakeAppStateOptions,
  FakeBundle,
  FakeBundleOptions,
  AttachOptions,
  StatefulEventStore,
  LocalValidator,
} from './factories.ts';

/**
 * Legacy alias — old call sites instantiated a class:
 *   const events = new FakeEventStore();
 * The class form is replaced by `makeFakeEventStore()` from `factories.ts`.
 * Keeping the type alias so any `: FakeEventStore` annotations still
 * compile against the new stateful shape.
 */
export type { StatefulEventStore as FakeEventStore } from './factories.ts';
