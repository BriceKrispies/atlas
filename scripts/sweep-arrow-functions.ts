#!/usr/bin/env tsx
/**
 * One-shot codemod: convert ArrowFunctionExpression → FunctionExpression.
 *
 * Drives the `atlas-no-arrow-functions` Semgrep rule in
 * `.semgrep/atlas-invariants.yml` (ported from the old
 * `eslint.config.ts ▸ no-restricted-syntax: ArrowFunctionExpression`). Uses TypeScript's transformer API so nested arrows
 * convert correctly in a single pass — text-edit-with-offsets clobbers
 * nested edits when the inner change shifts the outer's end position.
 *
 * SAFETY: arrow functions inherit `this` from their enclosing scope; plain
 * `function` expressions do not. Converting blindly would silently break
 * any code that relies on lexical `this`. So:
 *
 *   - Arrows whose body references `this` (anywhere, including nested
 *     non-arrow descendants — though nested function() resets `this` so
 *     those are fine) are SKIPPED and reported to stdout for manual review.
 *   - Arrows assigned as class field initialisers (`foo = () => …`) are
 *     SKIPPED — converting them changes binding semantics regardless of
 *     `this` usage (class-field arrows auto-bind to the instance).
 *
 * Everything else converts:
 *   `(a, b) => a + b`               → `function (a, b) { return a + b; }`
 *   `() => { stmt; }`               → `function () { stmt; }`
 *   `async (x) => x`                → `async function (x) { return x; }`
 *   `<T>(x: T): T => x`             → `function <T>(x: T): T { return x; }`
 *
 * Usage:
 *   pnpm tsx scripts/sweep-arrow-functions.ts        # full repo
 *   pnpm tsx scripts/sweep-arrow-functions.ts <dir>  # subset
 *
 * Idempotent: running again is a no-op once everything is converted.
 */

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(process.cwd());

const TARGET_DIRS = ['adapters', 'apps', 'modules', 'packages', 'ports', 'tests', 'bundles', 'scripts'];
const SKIP_NAMES = new Set([
  'node_modules',
  'dist',
  '.next',
  '.cache',
  '.vite',
  'generated',
  'coverage',
]);

interface Stats {
  filesScanned: number;
  filesModified: number;
  arrowsConverted: number;
  arrowsSkippedThis: number;
  arrowsSkippedClassField: number;
  skippedSites: Array<{ file: string; line: number; reason: string }>;
}

function isClassFieldInitialiser(arrow: ts.ArrowFunction): boolean {
  const p = arrow.parent;
  if (ts.isPropertyDeclaration(p) && p.initializer === arrow) return true;
  return false;
}

function bodyReferencesThis(arrow: ts.ArrowFunction): boolean {
  let found = false;
  function walk(node: ts.Node): void {
    if (found) return;
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node)
    ) {
      return;
    }
    if (node.kind === ts.SyntaxKind.ThisKeyword) {
      found = true;
      return;
    }
    ts.forEachChild(node, walk);
  }
  walk(arrow.body);
  return found;
}

function makeTransformer(
  stats: Stats,
  sourceFile: ts.SourceFile,
  filePath: string,
): ts.TransformerFactory<ts.SourceFile> {
  return function (context: ts.TransformationContext) {
    const factory = context.factory;
    function visit(node: ts.Node): ts.Node {
      if (ts.isArrowFunction(node)) {
        if (isClassFieldInitialiser(node)) {
          stats.arrowsSkippedClassField += 1;
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          stats.skippedSites.push({
            file: relative(ROOT, filePath),
            line: line + 1,
            reason: 'class-field initialiser (auto-bind semantics)',
          });
          return ts.visitEachChild(node, visit, context);
        }
        if (bodyReferencesThis(node)) {
          stats.arrowsSkippedThis += 1;
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          stats.skippedSites.push({
            file: relative(ROOT, filePath),
            line: line + 1,
            reason: 'references `this` (lexical-this required)',
          });
          return ts.visitEachChild(node, visit, context);
        }

        const visitedBody = ts.visitNode(node.body, visit) as ts.ConciseBody;
        const body: ts.Block = ts.isBlock(visitedBody)
          ? visitedBody
          : factory.createBlock([factory.createReturnStatement(visitedBody)], true);

        const params = ts.visitNodes(node.parameters, visit, ts.isParameter);
        const typeParams = node.typeParameters
          ? ts.visitNodes(node.typeParameters, visit, ts.isTypeParameterDeclaration)
          : undefined;

        const asyncMod = ts.canHaveModifiers(node)
          ? ts.getModifiers(node)?.find(function (m) {
              return m.kind === ts.SyntaxKind.AsyncKeyword;
            })
          : undefined;
        const modifiers = asyncMod
          ? [factory.createModifier(ts.SyntaxKind.AsyncKeyword)]
          : undefined;

        stats.arrowsConverted += 1;
        return factory.createFunctionExpression(
          modifiers,
          undefined,
          undefined,
          typeParams,
          params,
          node.type,
          body,
        );
      }
      return ts.visitEachChild(node, visit, context);
    }
    return function (file: ts.SourceFile): ts.SourceFile {
      return ts.visitNode(file, visit) as ts.SourceFile;
    };
  };
}

function processFile(absPath: string, stats: Stats, printer: ts.Printer): void {
  const source = readFileSync(absPath, 'utf-8');
  if (!source.includes('=>')) return;
  stats.filesScanned += 1;

  const sourceFile = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true);
  const before = stats.arrowsConverted;

  const result = ts.transform(sourceFile, [makeTransformer(stats, sourceFile, absPath)]);
  const transformed = result.transformed[0]!;

  if (stats.arrowsConverted === before) {
    result.dispose();
    return;
  }

  const out = printer.printFile(transformed);
  result.dispose();
  if (out !== source) {
    writeFileSync(absPath, out);
    stats.filesModified += 1;
  }
}

function shouldSkipDir(name: string): boolean {
  if (SKIP_NAMES.has(name)) return true;
  if (name.startsWith('.')) return true;
  return false;
}

function walkDir(dir: string, stats: Stats, printer: ts.Printer): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (shouldSkipDir(name)) continue;
    const full = join(dir, name);
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walkDir(full, stats, printer);
    } else if (s.isFile()) {
      if (full.endsWith('.ts') || full.endsWith('.tsx')) {
        if (full.endsWith(`scripts${sep}sweep-arrow-functions.ts`)) continue;
        if (full.includes(`${sep}generated${sep}`)) continue;
        processFile(full, stats, printer);
      }
    }
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const roots = args.length > 0 ? args : TARGET_DIRS;
  const stats: Stats = {
    filesScanned: 0,
    filesModified: 0,
    arrowsConverted: 0,
    arrowsSkippedThis: 0,
    arrowsSkippedClassField: 0,
    skippedSites: [],
  };
  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
    removeComments: false,
  });
  for (const r of roots) {
    const abs = resolve(ROOT, r);
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(abs);
    } catch {
      console.error(`skip: ${r} not found`);
      continue;
    }
    if (s.isDirectory()) {
      walkDir(abs, stats, printer);
    } else if (s.isFile()) {
      processFile(abs, stats, printer);
    }
  }

  console.log(
    `\nfiles scanned: ${stats.filesScanned.toString()} | modified: ${stats.filesModified.toString()} | arrows converted: ${stats.arrowsConverted.toString()} | skipped(this): ${stats.arrowsSkippedThis.toString()} | skipped(class-field): ${stats.arrowsSkippedClassField.toString()}`,
  );
  if (stats.skippedSites.length > 0) {
    console.log('\nskipped sites (need manual review):');
    for (const s of stats.skippedSites) {
      console.log(`  ${s.file}:${s.line.toString()} — ${s.reason}`);
    }
  }
}

main();
