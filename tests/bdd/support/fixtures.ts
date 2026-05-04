import { createBdd } from 'playwright-bdd';
import { test as simTest } from './sim-fixture.ts';

// `test` is the sim fixture composition (apps/sim boot + IDB probes).
// Lazy: tests / steps that don't destructure a sim fixture pay nothing.
// The placeholder under `tests/bdd/features/example-domain/` doesn't
// reference any sim fixture, so it continues to run as a vanilla
// Playwright smoke test without booting the harness.
export const test = simTest;

export const { Given, When, Then, Step, Before, After, BeforeStep, AfterStep } =
  createBdd(test);
