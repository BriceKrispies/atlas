// Empty by design — this package's surface is the test files under
// packages/arch-tests/test/. Vitest discovers them via the root config.
//
// Adding a public TypeScript surface here would be wrong: arch-tests are
// rules, not utilities. Helpers live colocated in the test files.
export {};
