#!/usr/bin/env node
/**
 * Codemod: rewrite every `tsx ...` invocation in package.json scripts
 * to `node --experimental-transform-types ...` (or, for the watch
 * variant, `node --watch --experimental-transform-types ...`). Drops
 * the `tsx` devDependency from every workspace package.json. Node 24's
 * built-in type stripping + transform-types replaces tsx entirely.
 *
 * Idempotent — running twice is a no-op once converged.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { Project } from 'ts-morph';

const ROOT = resolve(import.meta.dirname, '..');

const EXCLUDE = [/[\\/]node_modules[\\/]/, /[\\/]\.claude[\\/]/, /[\\/]dist[\\/]/];

function rewriteScript(script) {
  if (typeof script !== 'string') return script;
  // Watch mode first (more specific).
  if (script.startsWith('tsx watch ')) {
    return `node --watch --experimental-transform-types ${script.slice('tsx watch '.length)}`;
  }
  if (script.startsWith('tsx ')) {
    return `node --experimental-transform-types ${script.slice('tsx '.length)}`;
  }
  // Embedded `tsx ...` inside a chained script (e.g. `prebuild && tsx ...`).
  return script.replace(/\btsx (?:watch )?(\S+\.ts)/g, (m) =>
    m.startsWith('tsx watch ')
      ? `node --watch --experimental-transform-types ${m.slice('tsx watch '.length)}`
      : `node --experimental-transform-types ${m.slice('tsx '.length)}`,
  );
}

function processPackageJson(file) {
  const text = readFileSync(file, 'utf8');
  const pkg = JSON.parse(text);
  let touched = false;

  // Scripts.
  if (pkg.scripts) {
    for (const [k, v] of Object.entries(pkg.scripts)) {
      const next = rewriteScript(v);
      if (next !== v) {
        pkg.scripts[k] = next;
        touched = true;
      }
    }
  }

  // Dependencies — drop tsx everywhere. Replacement uses node directly.
  for (const bucket of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (pkg[bucket] && 'tsx' in pkg[bucket]) {
      delete pkg[bucket].tsx;
      touched = true;
      if (Object.keys(pkg[bucket]).length === 0) delete pkg[bucket];
    }
  }

  if (touched) {
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    return true;
  }
  return false;
}

const project = new Project({ useInMemoryFileSystem: false });
const fs = project.getFileSystem();

const patterns = [
  join(ROOT, 'package.json'),
  join(ROOT, 'packages/*/package.json'),
  join(ROOT, 'modules/*/package.json'),
  join(ROOT, 'adapters/*/package.json'),
  join(ROOT, 'apps/*/package.json'),
  join(ROOT, 'bundles/*/package.json'),
  join(ROOT, 'ports/package.json'),
];

const seen = new Set();
const changed = [];
for (const p of patterns) {
  for (const m of fs.globSync([p])) {
    if (seen.has(m) || EXCLUDE.some((rx) => rx.test(m))) continue;
    seen.add(m);
    if (processPackageJson(m)) changed.push(relative(ROOT, m).replace(/\\/g, '/'));
  }
}

console.log(`Updated ${changed.length} package.json files:`);
for (const f of changed) console.log(`  ${f}`);
