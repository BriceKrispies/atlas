// Shared step definitions reusable across domains/capabilities/journeys live
// here. Keep this file thin: prefer journey-local steps unless a step is truly
// generic (navigation, auth bootstrap, etc.).

import { Given } from '../../support/fixtures.ts';

/**
 * Re-authenticate the active sim session under a different role. Hoisted
 * here because both the authoring page-lifecycle and catalog family-publish
 * scenarios need it — registering it twice produces a "Multiple definitions
 * matched" error from playwright-bdd at scenario discovery time.
 *
 * Steps that take this path rely on the `reauthenticate` fixture from
 * `tests/bdd/support/sim-fixture.ts`.
 */
Given(
  'the admin is authenticated as a principal with role {string}',
  async ({ reauthenticate }, role: string) => {
    await reauthenticate({ role });
  },
);
