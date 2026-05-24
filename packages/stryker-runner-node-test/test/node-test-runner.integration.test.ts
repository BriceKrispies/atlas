/**
 * Integration tests for the NodeTestRunner plugin.
 *
 * Spins up the plugin against the tiny fixture in `test/fixtures/`
 * and asserts the structured results match expectations. These are
 * the closest the unit-test layer gets to what Stryker will actually
 * call at runtime — `capabilities`, `dryRun`, `mutantRun`.
 *
 * Strict TDD: tests fail until `src/node-test-runner.ts` is
 * implemented. We do NOT mock node-test or the parser — we want
 * end-to-end witness inside this package.
 */
import { afterEach, beforeEach, describe, it, expect } from '@atlas/test';
import { resolve } from 'node:path';
import {
  DryRunStatus,
  MutantRunStatus,
  TestStatus,
} from '@stryker-mutator/api/test-runner';
import { NodeTestRunner } from '../src/node-test-runner.ts';

const FIXTURE = resolve(
  import.meta.dirname,
  'fixtures/sample-feature.test.ts',
);

// Pin the runner's test-file selection to the fixture for every test
// in this file. mutantRun() can't accept testFiles via its options
// (Stryker's API doesn't expose them there), so the runner reads
// ATLAS_STRYKER_TEST_FILES instead — same mechanism the native
// Stryker config uses in production. Without this pinning the runner
// falls into `discoverTestFiles(cwd)` which would include this test
// file itself + the fixture + the parser/test-id tests, causing
// infinite recursion / cross-test contamination.
beforeEach(function () {
  process.env['ATLAS_STRYKER_TEST_FILES'] = FIXTURE;
});
afterEach(function () {
  delete process.env['ATLAS_STRYKER_TEST_FILES'];
});

describe('NodeTestRunner.capabilities', function () {
  it('declares reloadEnvironment: true (ESM cannot unload modules)', function () {
    const runner = new NodeTestRunner();
    const caps = runner.capabilities();
    expect(caps.reloadEnvironment).toBe(true);
  });
});

describe('NodeTestRunner.dryRun', function () {
  it('returns Complete with all three fixture tests reported as Success', async function () {
    const runner = new NodeTestRunner();
    const result = await runner.dryRun({
      coverageAnalysis: 'off',
      testFiles: [FIXTURE],
      timeout: 30_000,
      disableBail: false,
    });
    expect(result.status).toBe(DryRunStatus.Complete);
    if (result.status !== DryRunStatus.Complete) return;
    expect(result.tests.length).toBe(3);
    for (const t of result.tests) {
      expect(t.status).toBe(TestStatus.Success);
    }
    const ids = result.tests.map(function (t) {
      return t.id;
    });
    expect(
      ids.some(function (id) {
        return id.includes('sample feature::passes one');
      }),
    ).toBe(true);
  });
});

describe('NodeTestRunner.mutantRun', function () {
  it('returns Survived when no test fails (no mutation injected)', async function () {
    const runner = new NodeTestRunner();
    const result = await runner.mutantRun({
      activeMutant: {
        id: 'm-survived',
        mutatorName: 'fake',
        replacement: '{}',
        fileName: FIXTURE,
        location: {
          start: { line: 1, column: 0 },
          end: { line: 1, column: 0 },
        },
      },
      sandboxFileName: FIXTURE,
      timeout: 30_000,
      testFilter: undefined,
      mutantActivation: 'static',
      reloadEnvironment: true,
      disableBail: false,
    });
    expect(result.status).toBe(MutantRunStatus.Survived);
    if (result.status !== MutantRunStatus.Survived) return;
    expect(result.nrOfTests).toBe(3);
  });
});
