/**
 * Tier 1 BDD runner — Gherkin → vitest.
 *
 * Parses `.feature` files with a minimal in-house line parser, filters
 * scenarios by tag, and emits one vitest `it()` per kept scenario.
 *
 * Why a custom parser instead of `@cucumber/gherkin`: the cucumber
 * package is in node_modules transitively (via playwright-bdd) but
 * not a direct dep, so the TS compiler can't resolve its types. Rolling
 * our own (~50 LOC) avoids adding a dep AND keeps Gherkin support
 * narrowed to the subset we actually use here.
 *
 * Supported grammar:
 *   - Tags: `@word` (one or more on a single line, applies to the next
 *     Feature OR Scenario)
 *   - `Feature: <name>`
 *   - `Background:`
 *   - `Scenario: <name>`
 *   - Step lines: `Given|When|Then|And|But <text>` (And/But inherit the
 *     prior step kind)
 *   - `# comment` lines and blank lines are skipped
 *
 * NOT supported in this slice (would be a follow-up):
 *   - Scenario Outline / Examples / data tables
 *   - Doc strings (multi-line `"""..."""`)
 *   - Rule blocks
 */

import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import type { BddWorld } from './world.ts';

export type StepKind = 'Given' | 'When' | 'Then';
export type StepFn = (
  world: BddWorld,
  ...args: string[]
) => Promise<void> | void;

interface RegisteredStep {
  kind: StepKind;
  pattern: RegExp;
  fn: StepFn;
}

export class StepRegistry {
  private steps: RegisteredStep[] = [];

  Given(pattern: string | RegExp, fn: StepFn): this {
    this.steps.push({ kind: 'Given', pattern: toRegExp(pattern), fn });
    return this;
  }
  When(pattern: string | RegExp, fn: StepFn): this {
    this.steps.push({ kind: 'When', pattern: toRegExp(pattern), fn });
    return this;
  }
  Then(pattern: string | RegExp, fn: StepFn): this {
    this.steps.push({ kind: 'Then', pattern: toRegExp(pattern), fn });
    return this;
  }

  resolve(
    text: string,
    kindHint: StepKind,
  ): { fn: StepFn; args: string[] } | null {
    const matches: { fn: StepFn; args: string[] }[] = [];
    for (const s of this.steps) {
      if (s.kind !== kindHint) continue;
      const m = s.pattern.exec(text);
      if (m) matches.push({ fn: s.fn, args: m.slice(1) });
    }
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new Error(
        `[bdd] ambiguous step "${text}" matched ${matches.length} patterns`,
      );
    }
    return matches[0]!;
  }
}

/**
 * Cucumber-expression placeholders supported here:
 *   {string} → "([^"]*)"
 *   {int}    → (-?\d+)
 *   {word}   → (\S+)
 */
function toRegExp(p: string | RegExp): RegExp {
  if (p instanceof RegExp) return p;
  // Two-pass: escape regex metacharacters (NOT braces, since `{string}`
  // etc. are placeholders), then expand the placeholders into capture
  // groups.
  const escaped = p.replace(/[\\^$*+?.()|[\]]/g, '\\$&');
  const expanded = escaped
    .replace(/\{string\}/g, '"([^"]*)"')
    .replace(/\{int\}/g, '(-?\\d+)')
    .replace(/\{word\}/g, '(\\S+)');
  return new RegExp(`^${expanded}$`);
}

interface ParsedScenario {
  name: string;
  tags: Set<string>;
  steps: { kind: StepKind; text: string }[];
}

interface ParsedFeature {
  name: string;
  tags: Set<string>;
  background: { kind: StepKind; text: string }[];
  scenarios: ParsedScenario[];
}

function parseFeature(featurePath: string): ParsedFeature {
  const src = readFileSync(featurePath, 'utf8');
  const lines = src.split(/\r?\n/);
  let featureName = '';
  const featureTags = new Set<string>();
  const background: { kind: StepKind; text: string }[] = [];
  const scenarios: ParsedScenario[] = [];

  type Section = 'preface' | 'background' | 'scenario';
  let section: Section = 'preface';
  let pendingTags = new Set<string>();
  let lastKind: StepKind = 'Given';
  let currentScenario: ParsedScenario | null = null;

  const finalizeScenario = (): void => {
    if (currentScenario) scenarios.push(currentScenario);
    currentScenario = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    // Tags line — accumulate; applies to next Feature/Scenario.
    if (/^@/.test(line)) {
      for (const tag of line.split(/\s+/)) {
        if (tag.startsWith('@')) pendingTags.add(tag);
      }
      continue;
    }

    const featureMatch = /^Feature:\s*(.+)$/.exec(line);
    if (featureMatch) {
      featureName = featureMatch[1]!;
      for (const t of pendingTags) featureTags.add(t);
      pendingTags = new Set();
      section = 'preface';
      lastKind = 'Given';
      continue;
    }

    if (/^Background:\s*$/.test(line)) {
      finalizeScenario();
      section = 'background';
      lastKind = 'Given';
      continue;
    }

    const scenarioMatch = /^Scenario:\s*(.+)$/.exec(line);
    if (scenarioMatch) {
      finalizeScenario();
      section = 'scenario';
      lastKind = 'Given';
      currentScenario = {
        name: scenarioMatch[1]!,
        tags: new Set(pendingTags),
        steps: [],
      };
      pendingTags = new Set();
      continue;
    }

    // Step line.
    const stepMatch = /^(Given|When|Then|And|But|\*)\s+(.+)$/.exec(line);
    if (stepMatch) {
      const kw = stepMatch[1]!;
      const text = stepMatch[2]!;
      const kind: StepKind =
        kw === 'Given' || kw === 'When' || kw === 'Then'
          ? (kw as StepKind)
          : lastKind;
      lastKind = kind;
      if (section === 'background') {
        background.push({ kind, text });
      } else if (section === 'scenario' && currentScenario) {
        currentScenario.steps.push({ kind, text });
      }
      continue;
    }

    // Tables / doc strings / Rule / Scenario Outline currently unsupported.
    // Skip silently — the spike doesn't drive any scenarios that need them.
  }
  finalizeScenario();

  return {
    name: featureName,
    tags: featureTags,
    background,
    scenarios,
  };
}

export interface RunFeatureOptions {
  featurePath: string;
  steps: StepRegistry;
  newWorld: () => BddWorld;
  /**
   * Tag filter. Default: `['@phase-a1']` (Tier 1). Override via
   * `BDD_TAGS=@phase-a1,@phase-a2`.
   */
  tags?: string[];
}

/**
 * Drive a feature file. Generated `describe`/`it` blocks integrate
 * with vitest test discovery.
 */
export function runFeature(opts: RunFeatureOptions): void {
  const tags =
    opts.tags ??
    process.env['BDD_TAGS']?.split(',').map((s) => s.trim()) ??
    ['@phase-a1'];
  const tagSet = new Set(tags);
  const feature = parseFeature(opts.featurePath);

  describe(`[bdd] ${feature.name}`, () => {
    for (const sc of feature.scenarios) {
      const intersects =
        [...sc.tags].some((t) => tagSet.has(t)) ||
        [...feature.tags].some((t) => tagSet.has(t));
      if (!intersects) {
        // Skipped scenarios are visible in the report — easier to spot
        // missing tier coverage than silent omission.
        const tagStr = [...sc.tags].join(' ') || 'none';
        it.skip(`${sc.name} [tags: ${tagStr}]`, () => {
          // empty
        });
        continue;
      }
      it(sc.name, async () => {
        const world = opts.newWorld();
        for (const step of [...feature.background, ...sc.steps]) {
          const resolved = opts.steps.resolve(step.text, step.kind);
          if (!resolved) {
            throw new Error(
              `[bdd] no step binding for ${step.kind} "${step.text}". ` +
                `Add a registration in the .steps.ts module.`,
            );
          }
          await resolved.fn(world, ...resolved.args);
        }
      });
    }
  });
}
