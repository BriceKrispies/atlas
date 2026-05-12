/**
 * Tier 1 BDD runner — Gherkin → vitest.
 *
 * Parses `.feature` files with `@cucumber/gherkin` (the canonical
 * Cucumber parser), filters scenarios by tag, and emits one vitest
 * `it()` per kept scenario.
 *
 * Supported grammar (everything `@cucumber/gherkin@32` supports —
 * Feature/Background/Scenario, Scenario Outline + Examples, data
 * tables, doc strings, Rule blocks, i18n keywords, tags). The
 * runner currently DRIVES a subset of that — Scenario Outline
 * expansion + table/doc-string passthrough land as we hit features
 * that need them. Step bindings only see the simple kind+text shape
 * today.
 */

import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import {
  AstBuilder,
  GherkinClassicTokenMatcher,
  Parser,
} from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import type * as messages from '@cucumber/messages';
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
    const sole = matches[0];
    if (!sole) throw new Error('[bdd] internal: matches.length===1 but matches[0] missing');
    return sole;
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

/**
 * Parse a `.feature` file into the runner's internal shape via
 * `@cucumber/gherkin`. Cucumber's keyword field is whitespace-padded
 * (e.g. `'Given '`), so we trim before classifying.
 *
 * `And` / `But` / `*` inherit the prior step's kind — Cucumber
 * publishes those as their own keywords; we collapse them at parse
 * time so step bindings can register against `Given/When/Then` only.
 */
function parseFeature(featurePath: string): ParsedFeature {
  const src = readFileSync(featurePath, 'utf8');
  const uuidFn = IdGenerator.uuid();
  const parser = new Parser(
    new AstBuilder(uuidFn),
    new GherkinClassicTokenMatcher(),
  );
  const doc = parser.parse(src);
  const feature = doc.feature;
  if (!feature) throw new Error(`[bdd] no Feature in ${featurePath}`);

  const featureTags = new Set<string>(
    (feature.tags ?? []).map((t: messages.Tag) => t.name),
  );
  const background: ParsedFeature['background'] = [];
  const scenarios: ParsedScenario[] = [];

  for (const child of feature.children ?? []) {
    if (child.background) {
      let lastKind: StepKind = 'Given';
      for (const step of child.background.steps ?? []) {
        const kind = normalizeKeyword(step.keyword, lastKind);
        lastKind = kind;
        background.push({ kind, text: step.text });
      }
    } else if (child.scenario) {
      const sc = child.scenario;
      const scTags = new Set<string>(
        (sc.tags ?? []).map((t: messages.Tag) => t.name),
      );
      let lastKind: StepKind = 'Given';
      const steps: ParsedScenario['steps'] = [];
      for (const step of sc.steps ?? []) {
        const kind = normalizeKeyword(step.keyword, lastKind);
        lastKind = kind;
        steps.push({ kind, text: step.text });
      }
      scenarios.push({ name: sc.name, tags: scTags, steps });
    }
    // Rule blocks not surfaced yet — child.rule path would handle them.
  }

  return {
    name: feature.name,
    tags: featureTags,
    background,
    scenarios,
  };
}

function normalizeKeyword(keyword: string, prev: StepKind): StepKind {
  const k = keyword.trim();
  if (k === 'Given') return 'Given';
  if (k === 'When') return 'When';
  if (k === 'Then') return 'Then';
  // And / But / * inherit the prior step's kind.
  return prev;
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
