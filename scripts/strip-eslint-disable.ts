#!/usr/bin/env node
/**
 * strip-eslint-disable — one-shot codemod for the oxlint migration aftermath.
 *
 * Background: the repo migrated from eslint to oxlint in commit b5f7a7f.
 * Pre-existing `// eslint-disable-next-line @typescript-eslint/<rule>`
 * directives reference rules in the old eslint plugin namespace. oxlint
 * uses a different namespace (`typescript/<rule>` without the `@typescript-`
 * prefix); many of these directives are likely inert under the new linter.
 *
 * This codemod removes every `eslint-disable` directive from .ts/.tsx files
 * so we can run `pnpm lint` and observe what actually breaks. The lint
 * errors that fire after the codemod are the LOAD-BEARING sites that need
 * either a real fix or an `oxlint-disable` directive. Anything that stays
 * clean was inert noise.
 *
 * Strip patterns:
 *   1. Whole-line `// eslint-disable-next-line ...` — delete the entire line.
 *   2. Whole-line `/* eslint-disable ... *\/` — delete the entire line.
 *   3. Whole-line `/* eslint-enable ... *\/` — delete the entire line.
 *   4. Trailing `
 *   5. Multi-line `/* eslint-disable ... *\/`-to-`/* eslint-enable ... *\/`
 *      block comments — out of scope for this codemod (rare; would need a
 *      real parser to keep balance). Document any survivors after the run.
 *
 * Excluded paths (matches the .oxlintrc.json ignorePatterns broadly):
 *   - node_modules, dist, .vite, .git, test-results, playwright-report
 *   - .features-gen, archive
 *   - packages/schemas/src/generated (codegen output)
 */
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.vite',
  'test-results',
  'playwright-report',
  '.features-gen',
  'archive',
]);

const SKIP_SUBPATHS = [
  'packages/schemas/src/generated',
];

const TARGET_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);

// Regex catalogue. Lines are matched ONE AT A TIME, so block-comment
// suppressions that span lines are intentionally NOT stripped by this pass.
const WHOLE_LINE_DISABLE = /^\s*(?:\/\/|\/\*)\s*eslint-(?:disable(?:-next-line)?|enable)(?:[^*\n]*)?(?:\*\/)?\s*$/;
const TRAILING_DISABLE = /\s*\/\/\s*eslint-disable-line(?:\s[^\n]*)?$/;

interface StripResult {
  path: string;
  linesRemoved: number;
  trailingsStripped: number;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir);
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const info = await stat(full).catch(function () { return null; });
    if (info === null) continue;
    if (info.isDirectory()) {
      const rel = relative(ROOT, full).replace(/\\/g, '/');
      if (SKIP_SUBPATHS.some(function (s) { return rel === s || rel.startsWith(`${s}/`); })) {
        continue;
      }
      out.push(...(await walk(full)));
    } else if (info.isFile()) {
      const dot = name.lastIndexOf('.');
      const ext = dot < 0 ? '' : name.slice(dot);
      if (TARGET_EXTS.has(ext)) {
        out.push(full);
      }
    }
  }
  return out;
}

async function stripFile(path: string): Promise<StripResult> {
  const source = await readFile(path, 'utf8');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const lines = source.split(/\r?\n/);
  const kept: string[] = [];
  let linesRemoved = 0;
  let trailingsStripped = 0;

  for (const line of lines) {
    if (WHOLE_LINE_DISABLE.test(line)) {
      linesRemoved++;
      continue;
    }
    const stripped = line.replace(TRAILING_DISABLE, '');
    if (stripped !== line) trailingsStripped++;
    kept.push(stripped);
  }

  if (linesRemoved === 0 && trailingsStripped === 0) {
    return { path, linesRemoved: 0, trailingsStripped: 0 };
  }

  await writeFile(path, kept.join(eol), 'utf8');
  return { path, linesRemoved, trailingsStripped };
}

async function main(): Promise<void> {
  const files = await walk(ROOT);
  let totalLines = 0;
  let totalTrailings = 0;
  let filesChanged = 0;
  const changed: StripResult[] = [];

  for (const f of files) {
    const r = await stripFile(f);
    if (r.linesRemoved > 0 || r.trailingsStripped > 0) {
      filesChanged++;
      totalLines += r.linesRemoved;
      totalTrailings += r.trailingsStripped;
      changed.push(r);
    }
  }

  process.stdout.write(`scanned ${files.length} files\n`);
  process.stdout.write(`changed ${filesChanged} files\n`);
  process.stdout.write(`  whole-line directives removed: ${totalLines}\n`);
  process.stdout.write(`  trailing directives stripped:  ${totalTrailings}\n`);

  // Top 10 most-affected files (highest line count) for situational awareness.
  changed
    .sort(function (a, b) {
      return (b.linesRemoved + b.trailingsStripped) - (a.linesRemoved + a.trailingsStripped);
    })
    .slice(0, 10)
    .forEach(function (r) {
      const rel = relative(ROOT, r.path).replace(/\\/g, '/');
      process.stdout.write(`  ${r.linesRemoved + r.trailingsStripped}× ${rel}\n`);
    });
}

main().catch(function (e) {
  process.stderr.write(`strip-eslint-disable failed: ${(e as Error).stack ?? (e as Error).message}\n`);
  process.exit(1);
});
