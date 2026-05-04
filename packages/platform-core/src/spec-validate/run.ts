// Spec-validate runner.
//
// Port of `crates/spec_validate/src/lib.rs`. Loads each case, strips doc
// fields, dispatches to the matching validator, and inverts the outcome
// for `__invalid__` fixtures (where a validation failure is the expected
// pass condition).

import type { Case, Expect, Kind } from './discover.ts';
import { loadAndStrip } from './json.ts';
import { validate } from './validate.ts';

export interface RunOptions {
  /** Filter by kinds (empty / undefined = all kinds). */
  kinds?: ReadonlyArray<Kind>;
  /** Filter by expectation (undefined = all). */
  expect?: Expect;
}

export type Outcome =
  | { tag: 'pass' }
  | { tag: 'fail'; reason: string };

export interface CaseResult {
  case: Case;
  outcome: Outcome;
}

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  results: CaseResult[];
}

export function isCasePass(r: CaseResult): boolean {
  return r.outcome.tag === 'pass';
}

export function isRunSuccess(s: RunSummary): boolean {
  return s.failed === 0;
}

function matches(c: Case, opts: RunOptions): boolean {
  const kindMatches = !opts.kinds || opts.kinds.length === 0 || opts.kinds.includes(c.kind);
  const expectMatches = opts.expect === undefined || opts.expect === c.expect;
  return kindMatches && expectMatches;
}

/** Run validation across `cases`, applying `options` filters. */
export async function runValidation(
  cases: ReadonlyArray<Case>,
  options: RunOptions = {},
): Promise<RunSummary> {
  const summary: RunSummary = { total: 0, passed: 0, failed: 0, results: [] };

  for (const c of cases) {
    if (!matches(c, options)) continue;
    summary.total += 1;
    const result = await validateCase(c);
    if (isCasePass(result)) summary.passed += 1;
    else summary.failed += 1;
    summary.results.push(result);
  }

  return summary;
}

async function validateCase(c: Case): Promise<CaseResult> {
  let value: unknown;
  try {
    value = await loadAndStrip(c.path);
  } catch (e) {
    return {
      case: c,
      outcome: { tag: 'fail', reason: `JSON load error: ${(e as Error).message}` },
    };
  }

  let validationOk = true;
  let validationErrMsg = '';
  try {
    validate(c.kind, value);
  } catch (e) {
    validationOk = false;
    validationErrMsg = (e as Error).message;
  }

  // Invert outcome for `__invalid__` fixtures: a validation failure is the
  // expected outcome and counts as a pass.
  if (c.expect === 'valid' && validationOk) return { case: c, outcome: { tag: 'pass' } };
  if (c.expect === 'valid' && !validationOk) {
    return {
      case: c,
      outcome: { tag: 'fail', reason: `Expected valid but got: ${validationErrMsg}` },
    };
  }
  if (c.expect === 'invalid' && !validationOk) return { case: c, outcome: { tag: 'pass' } };
  return {
    case: c,
    outcome: { tag: 'fail', reason: 'Expected invalid but validation passed' },
  };
}
