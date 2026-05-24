/**
 * TAP-14 parser for `node --test --test-reporter=tap` output.
 *
 * node:test emits TAP with indentation-based nesting (each subtest
 * level is +4 spaces). The parser is line-buffered: feed `feed(line)`
 * for each line, then `drain()` at EOF for any final state. Emits a
 * flat stream of `TapEvent`s — the caller maps to test IDs + statuses.
 *
 * Scope kept narrow: only what the Stryker plugin needs (pass/fail/skip
 * statuses, test names, the YAML block of a failing test for the
 * `failureMessage` field). No plan-line handling, no bail-out semantics
 * beyond what node:test emits.
 */

export interface TapTestEvent {
  readonly kind: 'test';
  /** Outer-to-inner describe names; final element is the `it` name. */
  readonly name: readonly string[];
  readonly status: 'pass' | 'fail' | 'skip';
  /** `duration_ms` from the YAML block, if present. */
  readonly durationMs: number | null;
  /** Populated for `fail` only: parsed `error`/`stack` from the YAML block. */
  readonly failure: { message: string; stack: string | null } | null;
}

export type TapEvent = TapTestEvent;

export interface TapParser {
  feed(line: string): void;
  drain(): readonly TapEvent[];
}

// node:test indents subtests by 4 spaces per level. Depth 0 is at
// column 0, depth 1 at column 4, etc. Computing depth this way lets
// us reuse the same parser for arbitrarily deep nesting without
// hard-coding levels.
function indentDepth(line: string): number {
  let i = 0;
  while (i < line.length && line[i] === ' ') i++;
  return Math.floor(i / 4);
}

// Pending-test scratch: between an `ok` / `not ok` line and the
// emit. We park the test here while the optional YAML block
// (duration_ms, error, stack, ...) streams through, then emit on
// `...` (block end) or on the next non-YAML line.
interface PendingTest {
  depth: number;
  name: string;
  status: 'pass' | 'fail' | 'skip';
  durationMs: number | null;
  errorMessage: string | null;
  stack: string | null;
  inYaml: boolean;
  // While inside `stack: |-` (or another block scalar), accumulate
  // continuation lines. Cleared on key change or YAML end.
  stackBuf: string[] | null;
  // Indent prefix (spaces) at which the YAML's `---` and `...` lines
  // sit. Determines what's "inside" the YAML block.
  yamlIndent: number;
}

/**
 * Build a streaming TAP parser. Caller feeds lines one at a time
 * (stripping trailing CR/LF first), then calls `drain()` at EOF.
 */
export function createTapParser(): TapParser {
  // subtestNames[D] = the most recent `# Subtest: X` seen at depth D.
  // When an `ok`/`not ok` fires at depth D, its full name is
  // subtestNames[0..D-1].concat([resultName]).
  const subtestNames: string[] = [];
  const events: TapEvent[] = [];
  let pending: PendingTest | null = null;

  function emitPending(): void {
    if (!pending) return;
    const fullName = subtestNames.slice(0, pending.depth).concat([pending.name]);
    const failure =
      pending.status === 'fail'
        ? {
            message: pending.errorMessage ?? '',
            stack: pending.stack,
          }
        : null;
    events.push({
      kind: 'test',
      name: fullName,
      status: pending.status,
      durationMs: pending.durationMs,
      failure,
    });
    pending = null;
  }

  function startPending(
    depth: number,
    name: string,
    status: 'pass' | 'fail' | 'skip',
  ): void {
    // If we have a previous pending without a closing `...`, flush it
    // — node:test's tap output always closes a YAML block before
    // the next test line, but be defensive.
    emitPending();
    pending = {
      depth,
      name,
      status,
      durationMs: null,
      errorMessage: null,
      stack: null,
      inYaml: false,
      stackBuf: null,
      yamlIndent: depth * 4 + 2,
    };
  }

  function finishStackBuf(): void {
    if (!pending || pending.stackBuf === null) return;
    pending.stack = pending.stackBuf.join('\n');
    pending.stackBuf = null;
  }

  function feedYamlLine(line: string): boolean {
    if (!pending) return false;
    const trimmed = line.trimEnd();
    const indentSpaces = line.length - line.trimStart().length;
    if (trimmed === ' '.repeat(pending.yamlIndent) + '...') {
      finishStackBuf();
      pending.inYaml = false;
      emitPending();
      return true;
    }
    // Inside a multi-line block scalar (stack: |-)? Continuation
    // lines are indented STRICTLY more than the key.
    if (pending.stackBuf !== null && indentSpaces > pending.yamlIndent) {
      pending.stackBuf.push(line.slice(pending.yamlIndent + 2));
      return true;
    }
    // Otherwise we're back at the YAML key-indent level. Close any
    // open block scalar.
    finishStackBuf();
    // Parse `<key>: <value>` (value may be quoted, may start a block).
    const keyMatch = /^[ ]+([A-Za-z_]\w*):\s?(.*)$/.exec(trimmed);
    if (!keyMatch) return true;
    const key = keyMatch[1] ?? '';
    const rawValue = keyMatch[2] ?? '';
    if (key === 'duration_ms') {
      const n = Number(rawValue);
      pending.durationMs = Number.isFinite(n) ? n : null;
    } else if (key === 'error') {
      pending.errorMessage = unquote(rawValue);
    } else if (key === 'stack') {
      if (rawValue === '|-' || rawValue === '|') {
        pending.stackBuf = [];
      } else {
        pending.stack = unquote(rawValue);
      }
    }
    // Unknown keys (failureType, code, etc.) silently ignored.
    return true;
  }

  function unquote(v: string): string {
    if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
      return v.slice(1, -1).replace(/''/g, "'");
    }
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
      return v.slice(1, -1).replace(/\\"/g, '"');
    }
    return v;
  }

  function feed(line: string): void {
    // Normalize CR (Windows TAP output sometimes carries \r at EOL).
    const ln = line.replace(/\r$/, '');
    // YAML mode takes precedence — `...` ends it, anything else is content.
    if (pending && pending.inYaml) {
      feedYamlLine(ln);
      return;
    }
    const depth = indentDepth(ln);
    const trimmed = ln.slice(depth * 4);
    // Subtest declaration: `# Subtest: <name>`
    const subtestMatch = /^# Subtest:\s+(.*)$/.exec(trimmed);
    if (subtestMatch) {
      const name = subtestMatch[1] ?? '';
      subtestNames[depth] = name;
      // Drop any deeper levels — entering a new subtest at this depth
      // invalidates anything nested under a prior sibling.
      subtestNames.length = depth + 1;
      return;
    }
    // ok / not ok line
    const okMatch = /^(ok|not ok)\s+\d+\s*-\s*(.+?)(\s+#\s+(SKIP|TODO).*)?$/.exec(
      trimmed,
    );
    if (okMatch) {
      const verdict = okMatch[1];
      const name = okMatch[2] ?? '';
      const directive = okMatch[4];
      let status: 'pass' | 'fail' | 'skip';
      if (directive === 'SKIP') status = 'skip';
      else if (verdict === 'ok') status = 'pass';
      else status = 'fail';
      startPending(depth, name, status);
      return;
    }
    // YAML block start: `---` indented one level under the test.
    if (pending && /^\s+---\s*$/.test(ln)) {
      pending.inYaml = true;
      pending.yamlIndent = ln.length - ln.trimStart().length;
      return;
    }
    // Plan line (`1..N`), comments (`# tests`, etc.), `TAP version` —
    // safe to ignore. If we have a pending test without an opened
    // YAML block (no `---` follow-up), emit it now so we don't lose it.
    if (pending && !pending.inYaml) {
      emitPending();
    }
  }

  function drain(): readonly TapEvent[] {
    // Emit any final pending test that didn't get a `...` follow-up.
    if (pending && pending.inYaml) {
      finishStackBuf();
      pending.inYaml = false;
    }
    emitPending();
    return events.slice();
  }

  return { feed, drain };
}
