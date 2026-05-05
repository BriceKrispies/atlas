/**
 * Tier 1 BDD entry-point for `password.feature`.
 *
 * The vitest runner picks this up via the standard `*.test.ts` glob.
 * The `runFeature` call generates one `it()` per scenario at module
 * load — vitest test discovery sees them like any other test.
 */

import { fileURLToPath } from 'node:url';
import { runFeature } from './runner.ts';
import { freshWorld } from './world.ts';
import { passwordSteps } from './password.steps.ts';

const featurePath = fileURLToPath(
  new URL(
    '../../../../specs/domains/identity/features/password/password.feature',
    import.meta.url,
  ),
);

runFeature({
  featurePath,
  steps: passwordSteps,
  newWorld: () => freshWorld('smb'),
  // Default Tier 1 tag set; override via `BDD_TAGS=...` env.
  tags: process.env['BDD_TAGS']?.split(',').map((s) => s.trim()) ?? [
    '@phase-a1',
  ],
});
