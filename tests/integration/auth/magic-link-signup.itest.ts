/**
 * E2E auth: magic-link signup (Layer 3).
 *
 * The canonical worked example for this flow lives at
 * `tests/integration/public-signup.itest.ts` (448 lines, hardened
 * across 9 fixes). This file exists as a sibling under
 * `tests/integration/auth/` so the auth-suite layout is complete; it
 * is intentionally a thin re-export pointer rather than a duplicate.
 *
 * **If you're adding new public-signup scenarios:** put them in the
 * canonical file. This file's only job is to make the directory
 * structure complete and to give CI a discoverable
 * `tests/integration/auth/magic-link-signup.itest.ts` hit when
 * filtering by the auth path.
 */

import { test } from '@playwright/test';

test.describe('e2e — magic-link signup (canonical)', () => {
  test('the public-signup loop is covered by `tests/integration/public-signup.itest.ts`', () => {
    test.info().annotations.push({
      type: 'pointer',
      description:
        'The full magic-link signup flow (form → smtp4dev → magic-link → ' +
        'tenant home) is in tests/integration/public-signup.itest.ts. ' +
        'Add new scenarios there.',
    });
    // Intentional no-op test body: the assertion is the annotation.
    // Removing this file would leave a hole in the auth-suite directory
    // structure; consolidating into public-signup.itest.ts requires a
    // separate decision on whether public-signup is auth-shaped enough
    // to live under auth/ vs at tests/integration/ root.
  });
});
