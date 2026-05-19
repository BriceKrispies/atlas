/**
 * Tiny typed dependency scanner for arch tests.
 *
 * Recursively walks a folder under the repo root, parses static
 * `import` / `export … from` / `require()` specifiers out of every
 * TypeScript file, and returns the relative paths of files whose
 * specifier matches a forbidden pattern.
 *
 * Why not a third-party arch lib: the rules we want to enforce are
 * trivially "no file in folder X imports module matching Y" — a
 * 30-line scanner is easier to type, simpler to debug, and adds no
 * surface area. Lives in `test/` (not `src/`) because arch-tests are
 * rules, not utilities exported to the rest of the workspace.
 */

import { promises as fs } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// test/ → packages/arch-tests → packages → repo root
const REPO_ROOT = resolve(HERE, '..', '..', '..');

const SOURCE_FILE_RE = /\.(?:ts|tsx|mts|cts)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.vite']);

// Single regex with two alternatives keeps capture-group indexing
// simple: group 1 = static import / export-from, group 2 = require().
const IMPORT_SPEC_RE =
  /(?:^|[\s;{}])(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

export async function findImportViolations(
  folder: string,
  forbidden: RegExp,
): Promise<string[]> {
  const root = join(REPO_ROOT, folder);
  const files: string[] = [];
  await collectSourceFiles(root, files);

  const violations: string[] = [];
  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    if (hasForbiddenImport(text, forbidden)) {
      violations.push(relative(REPO_ROOT, file).replace(/\\/g, '/'));
    }
  }
  return violations.sort();
}

function hasForbiddenImport(source: string, forbidden: RegExp): boolean {
  // Reset lastIndex so the shared regex is safe to reuse across calls.
  IMPORT_SPEC_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_SPEC_RE.exec(source)) !== null) {
    const spec = match[1] ?? match[2];
    if (spec !== undefined && forbidden.test(spec)) return true;
  }
  return false;
}

function isMissingPathError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === 'ENOENT'
  );
}

async function collectSourceFiles(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissingPathError(err)) return;
    throw err;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collectSourceFiles(full, out);
    } else if (entry.isFile() && SOURCE_FILE_RE.test(entry.name)) {
      out.push(full);
    }
  }
}
