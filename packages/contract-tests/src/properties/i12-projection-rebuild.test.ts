/**
 * Self-test for the I12 projection-rebuild property ("test the test").
 *
 * @spec: specs/crosscut/testing.md#§6.3-property-test
 * @spec: specs/architecture.md#i12-projections-are-rebuildable
 */
import { describe, test } from '@atlas/test';
import { runProperty, type Projector } from './i12-projection-rebuild.ts';
import {
  expectPropertyToCatchViolation,
  expectPropertyToHold,
} from './_self-test.ts';
import { MemEventStore } from './_fakes.ts';

/** Read-model state: live resource ids → kind. */
type State = Record<string, string>;

/** Correct projector: pure last-write-wins fold over events. */
const correctProjector: Projector<State> = {
  empty: () => ({}),
  apply: (state, event) => {
    const { resourceId, kind } = event.payload as { resourceId: string; kind: string };
    if (kind === 'deleted') {
      const { [resourceId]: _drop, ...rest } = state;
      return rest;
    }
    return { ...state, [resourceId]: kind };
  },
  serialize: (s) =>
    JSON.stringify(
      Object.fromEntries(Object.entries(s).sort(([a], [b]) => a.localeCompare(b))),
    ),
};

/**
 * BROKEN (determinism): folds wall-clock time into the state, so two
 * rebuilds of the same history diverge. Violates I12 corollary 1.
 */
const nonDeterministicProjector: Projector<State> = {
  empty: () => ({}),
  apply: (state, event) => {
    const { resourceId, kind } = event.payload as { resourceId: string; kind: string };
    // Pollute with a non-event input — high-resolution time.
    return { ...state, [resourceId]: `${kind}@${process.hrtime.bigint()}` };
  },
  serialize: correctProjector.serialize,
};

/**
 * BROKEN (idempotent dispatch): counts every applied event for a resource
 * instead of last-write-wins, so re-applying the same history changes the
 * state. Violates I12 corollary 2.
 */
type CountState = Record<string, number>;
const nonIdempotentProjector: Projector<CountState> = {
  empty: () => ({}),
  apply: (state, event) => {
    const { resourceId } = event.payload as { resourceId: string };
    return { ...state, [resourceId]: (state[resourceId] ?? 0) + 1 };
  },
  serialize: (s: CountState) =>
    JSON.stringify(
      Object.fromEntries(Object.entries(s).sort(([a], [b]) => a.localeCompare(b))),
    ),
};

const makeStore = async () => new MemEventStore();

describe('I12 projection-rebuild property', function () {
  test('holds for a pure last-write-wins projector', async function () {
    await expectPropertyToHold(() =>
      runProperty({ makeStore, projector: correctProjector }),
    );
  });

  test('catches + shrinks a projector that folds in wall-clock time', async function () {
    await expectPropertyToCatchViolation(() =>
      runProperty({ makeStore, projector: nonDeterministicProjector }),
    );
  });

  test('catches + shrinks a projector with non-idempotent dispatch', async function () {
    await expectPropertyToCatchViolation(() =>
      runProperty({ makeStore, projector: nonIdempotentProjector }),
    );
  });
});
