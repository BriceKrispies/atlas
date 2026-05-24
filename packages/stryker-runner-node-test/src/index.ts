/**
 * `@atlas/stryker-runner-node-test` — native Stryker TestRunner plugin
 * for Atlas's `node:test`-based suite.
 *
 * Stryker auto-discovers plugins via the `strykerPlugins` export.
 *
 * Spec: `C:\Users\Brice\.claude\plans\twinkly-popping-deer.md`.
 */
import { declareClassPlugin, PluginKind } from '@stryker-mutator/api/plugin';
import { NodeTestRunner } from './node-test-runner.ts';

export { NodeTestRunner } from './node-test-runner.ts';
export {
  createTapParser,
  type TapEvent,
  type TapParser,
  type TapTestEvent,
} from './tap-parser.ts';
export { makeTestId, type TestIdParts } from './test-id.ts';
export { discoverTestFiles } from './sandbox-glob.ts';

export const strykerPlugins = [
  declareClassPlugin(PluginKind.TestRunner, 'node-test', NodeTestRunner),
];
