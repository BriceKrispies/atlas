// Spec-validate harness — TypeScript port of `crates/spec_validate`.
//
// Re-exports the public surface (discovery, JSON loading, dispatcher,
// runner). The Rust CLI binary is intentionally NOT ported.

export type { Kind, Expect, Case, ParseResult, DiscoveryResult } from './discover.ts';
export { ALL_KINDS, parseFilename, discover, caseId } from './discover.ts';

export { JsonLoadError, load, stripDocFields, loadAndStrip } from './json.ts';

export { AdapterError, validate } from './validate.ts';

export type { RunOptions, Outcome, CaseResult, RunSummary } from './run.ts';
export { runValidation, isCasePass, isRunSuccess } from './run.ts';
