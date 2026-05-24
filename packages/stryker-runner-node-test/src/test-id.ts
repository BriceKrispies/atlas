/**
 * Stryker test-ID scheme for `node:test` runs.
 *
 * The contract: the SAME (filePath, describePath, itName) triple
 * MUST produce the SAME ID across `dryRun` and `mutantRun`. Stryker
 * relies on stable test IDs to map source coverage to mutants and to
 * filter tests per-mutant. ID divergence would break parity with the
 * command runner — see plan, Phase 2.
 */
export interface TestIdParts {
  /** Sandbox-relative POSIX path to the test file, e.g. `modules/identity/test/handlers.test.ts`. */
  readonly filePath: string;
  /** Outer-to-inner describe names. Empty for top-level tests. */
  readonly describePath: readonly string[];
  /** Name of the `it`/`test` block. */
  readonly itName: string;
}

const SEPARATOR = '::';
const DESCRIBE_JOIN = ' > ';

/**
 * Build a stable test ID from its location. Format:
 *
 *     <filePath>::<describePath joined by " > ">::<itName>
 *
 * When the test has no enclosing describe, the middle segment is the
 * literal empty string (still two `::` separators) so parsing stays
 * unambiguous. Pure function — same input always yields same output.
 */
export function makeTestId(parts: TestIdParts): string {
  const describe = parts.describePath.join(DESCRIBE_JOIN);
  return `${parts.filePath}${SEPARATOR}${describe}${SEPARATOR}${parts.itName}`;
}
