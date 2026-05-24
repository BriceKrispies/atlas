#!/usr/bin/env node --experimental-transform-types
/**
 * Deterministic test-coverage inventory.
 *
 * Walks every .ts source file under adapters/ ports/ modules/ packages/ apps/
 * bundles/, classifies each as has-test / legitimate-no-test / gap, and writes
 * a regenerable markdown report + baseline JSON.
 *
 * Invoke:
 *   pnpm test-coverage:inventory                # write report + baseline
 *   pnpm test-coverage:inventory:check          # exit 1 if gap grew or hasTest dropped
 *   node ... test-coverage-inventory.ts --update-baseline   # ratchet baseline
 *
 * Mirrors scripts/overseer-check.ts conventions: own walker, no glob lib, regex
 * matching, runs via --experimental-transform-types.
 *
 * Plan: ~/.claude/plans/i-would-like-for-sprightly-hartmanis.md
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config, type Category, type Rule } from './test-coverage-inventory.config.ts';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const CHECK = process.argv.includes('--check');
const UPDATE_BASELINE = process.argv.includes('--update-baseline');

const ROOTS = ['adapters', 'modules', 'packages', 'ports', 'apps', 'bundles'];

const EXCLUDE_DIRS = new Set([
  'node_modules', 'dist', 'build', '.turbo', 'coverage',
  'storybook-static', '.git', '.next', 'playwright-report', 'tsdist',
  '.claude',
]);

const EXCLUDE_FILE_NAMES = new Set([
  'vite.config.ts',
  'vitest.config.ts',
]);

const REPORT_PATH = 'tickets/testing-floor/colocated-test-inventory.generated.md';
const BASELINE_PATH = 'tickets/testing-floor/colocated-test-inventory.baseline.json';

// ── Walker ────────────────────────────────────────────────────────────────

function* walkTs(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  // Sort entries for deterministic walk order.
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (EXCLUDE_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkTs(full);
    } else if (e.isFile()) {
      if (!e.name.endsWith('.ts')) continue;
      if (e.name.endsWith('.d.ts')) continue;
      if (e.name.endsWith('.stories.ts')) continue;
      if (EXCLUDE_FILE_NAMES.has(e.name)) continue;
      yield full;
    }
  }
}

function rel(file: string): string {
  return relative(REPO_ROOT, file).split(sep).join('/');
}

function isTestFile(relPath: string): boolean {
  return relPath.endsWith('.test.ts') || relPath.endsWith('.spec.ts');
}

function inSrcTree(relPath: string): boolean {
  // Only consider files under */src/ to mirror the manual sweep scope.
  // ports/ has src/ too; ports/src/foo.ts → /src/ present after first segment.
  return relPath.includes('/src/');
}

// ── Glob matcher (POSIX paths, `**` any-depth, `*` single-segment) ───────

function globToRegex(g: string): RegExp {
  let out = '';
  let i = 0;
  while (i < g.length) {
    const c = g[i]!;
    if (c === '*') {
      if (g[i + 1] === '*') {
        // ** form
        if (g[i + 2] === '/') {
          // foo/**/bar  →  foo/(?:.*/)?bar  AND  foo/bar (zero-segment)
          out += '(?:.*/)?';
          i += 3;
          continue;
        }
        if (i + 2 === g.length) {
          // trailing /**
          out += '.*';
          i += 2;
          continue;
        }
        // bare ** mid-pattern — treat as `.*`
        out += '.*';
        i += 2;
        continue;
      }
      // single *
      out += '[^/]*';
      i += 1;
      continue;
    }
    if ('.+^$|()[]{}\\?'.includes(c)) {
      out += '\\' + c;
    } else {
      out += c;
    }
    i += 1;
  }
  return new RegExp('^' + out + '$');
}

const compiledRules: { rule: Rule; re: RegExp }[] = config.rules.map((rule) => ({
  rule,
  re: globToRegex(rule.glob),
}));

const explicitNoTestMap = new Map<string, string>(
  config.explicitNoTest.map((e) => [e.path, e.reason] as const),
);

// ── Heuristics ────────────────────────────────────────────────────────────

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const BARREL_LINE = /^export\s+(\*|type\s+\*|type\s+\{[^}]*\}|\{[^}]*\})\s+from\s+['"][^'"]+['"]\s*;?$/;

function isPureBarrel(src: string): boolean {
  const lines = stripComments(src)
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (lines.length === 0) return false;
  return lines.every((line) => BARREL_LINE.test(line));
}

const RUNTIME_KEYWORD = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class)\s+\w+/m;
const TOP_LEVEL_BINDING = /^(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+\w+/m;

function isTypesOnly(src: string): boolean {
  const stripped = stripComments(src);
  if (RUNTIME_KEYWORD.test(stripped)) return false;
  if (TOP_LEVEL_BINDING.test(stripped)) return false;
  return true;
}

// ── Classification ───────────────────────────────────────────────────────

type Classification = {
  path: string;
  category: Category;
  reason?: string;
};

function classify(
  relPath: string,
  hasColocated: boolean,
  readSrc: () => string,
): Classification {
  if (hasColocated) {
    return { path: relPath, category: 'has-test' };
  }

  // Explicit allowlist beats path rules — it's the manual override.
  const explicitReason = explicitNoTestMap.get(relPath);
  if (explicitReason !== undefined) {
    return { path: relPath, category: 'explicit-no-test', reason: explicitReason };
  }

  for (const { rule, re } of compiledRules) {
    if (!re.test(relPath)) continue;
    if (rule.requires === 'heuristic-barrel') {
      if (!isPureBarrel(readSrc())) continue;
    } else if (rule.requires === 'heuristic-types-only') {
      if (!isTypesOnly(readSrc())) continue;
    }
    return { path: relPath, category: rule.category };
  }

  return { path: relPath, category: 'gap' };
}

// ── Main sweep ───────────────────────────────────────────────────────────

interface SweepResult {
  total: number;
  hasTest: number;
  legitimate: number;
  gap: number;
  byCategory: Map<Category, Classification[]>;
}

function sweep(): SweepResult {
  // Pass 1: gather all candidate .ts files (under */src/), and the set of
  // colocated test files.
  const allFiles: string[] = [];
  const testFiles = new Set<string>();
  for (const root of ROOTS) {
    const abs = join(REPO_ROOT, root);
    if (!existsSync(abs)) continue;
    for (const file of walkTs(abs)) {
      const relPath = rel(file);
      if (!inSrcTree(relPath)) continue;
      if (isTestFile(relPath)) {
        testFiles.add(relPath);
        continue;
      }
      allFiles.push(relPath);
    }
  }
  allFiles.sort();

  // Pass 2: classify each source file.
  const byCategory = new Map<Category, Classification[]>();
  for (const relPath of allFiles) {
    const testSibling = relPath.replace(/\.ts$/, '.test.ts');
    const hasColocated = testFiles.has(testSibling);
    const c = classify(relPath, hasColocated, () =>
      readFileSync(join(REPO_ROOT, relPath), 'utf8'),
    );
    let bucket = byCategory.get(c.category);
    if (!bucket) {
      bucket = [];
      byCategory.set(c.category, bucket);
    }
    bucket.push(c);
  }

  const hasTest = (byCategory.get('has-test') ?? []).length;
  const gap = (byCategory.get('gap') ?? []).length;
  const legitimate = allFiles.length - hasTest - gap;

  return {
    total: allFiles.length,
    hasTest,
    legitimate,
    gap,
    byCategory,
  };
}

// ── Report writer ────────────────────────────────────────────────────────

function gitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return '(no-git)';
  }
}

const CATEGORY_ORDER: Category[] = [
  'has-test',
  'gap',
  'barrel',
  'surface-contract',
  'port-interface',
  'port-helper',
  'test-infrastructure',
  'scaffolding',
  'static-asset',
  'wiring',
  'types',
  'explicit-no-test',
];

const CATEGORY_HEADINGS: Record<Category, string> = {
  'has-test': 'Has colocated test',
  'gap': 'Real gaps (needs test)',
  'barrel': 'Barrels (pure re-exports)',
  'surface-contract': 'Surface contracts (type-only contracts)',
  'port-interface': 'Port interfaces',
  'port-helper': 'Port helpers (runtime — could test)',
  'test-infrastructure': 'Test infrastructure',
  'scaffolding': 'Scaffolding / fixtures',
  'static-asset': 'Static assets / constants',
  'wiring': 'Wiring (composition only)',
  'types': 'Type-only files',
  'explicit-no-test': 'Explicitly excluded (with reason)',
};

function renderReport(result: SweepResult): string {
  const sha = gitShortSha();

  const lines: string[] = [];
  lines.push('---');
  lines.push('title: Colocated test-coverage inventory (generated)');
  lines.push('status: generated');
  lines.push('type: inventory');
  lines.push(`git_head: ${sha}`);
  lines.push('---');
  lines.push('');
  lines.push('> **Do not hand-edit.** Regenerated by `pnpm test-coverage:inventory`.');
  lines.push('> Curated narrative + decisions live at [`colocated-test-inventory.md`](./colocated-test-inventory.md).');
  lines.push('> Config: [`scripts/test-coverage-inventory.config.ts`](../../scripts/test-coverage-inventory.config.ts).');
  lines.push('');
  lines.push('## Headline counts');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total source \`.ts\` files (\`*/src/**\`) | ${result.total} |`);
  lines.push(`| Has colocated \`*.test.ts\` sibling | ${result.hasTest} |`);
  lines.push(`| Legitimate no-test (classified) | ${result.legitimate} |`);
  lines.push(`| **Real gaps** (uncategorised, needs test) | **${result.gap}** |`);
  lines.push('');

  // Per-category counts
  lines.push('## Breakdown by category');
  lines.push('');
  lines.push('| Category | Count |');
  lines.push('|----------|-------|');
  for (const cat of CATEGORY_ORDER) {
    const bucket = result.byCategory.get(cat) ?? [];
    if (bucket.length === 0) continue;
    lines.push(`| ${CATEGORY_HEADINGS[cat]} | ${bucket.length} |`);
  }
  lines.push('');

  // Per-root totals
  lines.push('## Per-root totals');
  lines.push('');
  lines.push('| Root | Total | Has test | Gap | Legitimate |');
  lines.push('|------|-------|----------|-----|------------|');
  for (const root of ROOTS) {
    let total = 0,
      hasTest = 0,
      gap = 0;
    for (const [cat, bucket] of result.byCategory) {
      for (const entry of bucket) {
        if (!entry.path.startsWith(`${root}/`)) continue;
        total++;
        if (cat === 'has-test') hasTest++;
        else if (cat === 'gap') gap++;
      }
    }
    if (total === 0) continue;
    lines.push(`| \`${root}/\` | ${total} | ${hasTest} | ${gap} | ${total - hasTest - gap} |`);
  }
  lines.push('');

  // Render sections in category order
  for (const cat of CATEGORY_ORDER) {
    const bucket = result.byCategory.get(cat) ?? [];
    if (bucket.length === 0) continue;
    lines.push(`## ${CATEGORY_HEADINGS[cat]} (${bucket.length})`);
    lines.push('');
    if (cat === 'has-test') {
      // Compact listing — these are the wins.
      for (const entry of bucket) {
        lines.push(`- \`${entry.path}\``);
      }
    } else if (cat === 'explicit-no-test') {
      for (const entry of bucket) {
        lines.push(`- \`${entry.path}\` — ${entry.reason ?? ''}`);
      }
    } else {
      for (const entry of bucket) {
        lines.push(`- \`${entry.path}\``);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Baseline + check ─────────────────────────────────────────────────────

interface Baseline {
  totals: { total: number; hasTest: number; legitimate: number; gap: number };
}

function readBaseline(): Baseline | null {
  const abs = join(REPO_ROOT, BASELINE_PATH);
  if (!existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, 'utf8')) as Baseline;
  } catch {
    return null;
  }
}

function writeBaseline(result: SweepResult): void {
  const baseline: Baseline = {
    totals: {
      total: result.total,
      hasTest: result.hasTest,
      legitimate: result.legitimate,
      gap: result.gap,
    },
  };
  writeFileSync(
    join(REPO_ROOT, BASELINE_PATH),
    JSON.stringify(baseline, null, 2) + '\n',
    'utf8',
  );
}

function writeReport(result: SweepResult): void {
  writeFileSync(join(REPO_ROOT, REPORT_PATH), renderReport(result), 'utf8');
}

// ── Entry ────────────────────────────────────────────────────────────────

function main(): number {
  const result = sweep();

  const summary =
    `total=${result.total}  hasTest=${result.hasTest}  legitimate=${result.legitimate}  gap=${result.gap}`;

  if (CHECK) {
    const baseline = readBaseline();
    if (!baseline) {
      process.stderr.write(
        `test-coverage:inventory:check — no baseline at ${BASELINE_PATH}; run without --check to create one.\n`,
      );
      return 2;
    }
    process.stdout.write(`test-coverage:inventory  ${summary}\n`);
    const drift: string[] = [];
    if (result.gap > baseline.totals.gap) {
      drift.push(
        `gap grew: ${baseline.totals.gap} → ${result.gap} (+${result.gap - baseline.totals.gap})`,
      );
    }
    if (result.hasTest < baseline.totals.hasTest) {
      drift.push(
        `hasTest shrank: ${baseline.totals.hasTest} → ${result.hasTest} (-${baseline.totals.hasTest - result.hasTest})`,
      );
    }
    if (drift.length === 0) {
      process.stdout.write('Result: PASS — no regression vs baseline.\n');
      return 0;
    }
    process.stderr.write('Result: FAIL — regression vs baseline:\n');
    for (const d of drift) process.stderr.write(`  ${d}\n`);
    process.stderr.write(
      `\nIf intentional, run \`pnpm test-coverage:inventory --update-baseline\` to ratchet.\n`,
    );
    return 1;
  }

  writeReport(result);
  if (UPDATE_BASELINE || !readBaseline()) {
    writeBaseline(result);
  } else {
    // Default mode also rewrites baseline so the report and baseline stay in sync.
    writeBaseline(result);
  }
  process.stdout.write(`test-coverage:inventory  ${summary}\n`);
  process.stdout.write(`Wrote ${REPORT_PATH}\n`);
  process.stdout.write(`Wrote ${BASELINE_PATH}\n`);
  return 0;
}

process.exit(main());
