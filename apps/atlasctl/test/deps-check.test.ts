/**
 * Architectural lint enforcing INV-CTL-01 (HTTP Client Only) and the
 * Prohibited Coupling list in specs/crosscut/atlasctl.md.
 *
 * atlasctl MUST NOT depend on apps/server, apps/projection-worker,
 * @atlas/ports, @atlas/adapter-*, @atlas/authz, @atlas/catalog,
 * @atlas/content-pages, @atlas/identity, @atlas/tenancy, or modules/*.
 *
 * This test reads package.json (declared deps) AND walks the source tree
 * looking for `import` and `from` statements that reference forbidden
 * package names.
 */
import { describe, it, expect } from '@atlas/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(here, '..');
const FORBIDDEN_DEPS: ReadonlyArray<string> = [
    '@atlas/ports',
    '@atlas/adapter-node',
    '@atlas/adapter-idb',
    '@atlas/adapter-policy-cedar',
    '@atlas/adapter-policy-stub',
    '@atlas/authz',
    '@atlas/catalog',
    '@atlas/content-pages',
    '@atlas/identity',
    '@atlas/tenancy',
    '@atlas/server',
    '@atlas/projection-worker',
    '@atlas/ingress',
    '@atlas/wasm-host',
];
const FORBIDDEN_PATH_PREFIXES: ReadonlyArray<string> = [
    'apps/server',
    'apps/projection-worker',
    'modules/',
    'adapters/',
    'ports/',
];
interface PackageJson {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
}
describe('atlasctl deps (INV-CTL-01)', function () {
    it('package.json declares no forbidden runtime dependencies', function () {
        const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf-8')) as PackageJson;
        const declared = Object.keys(pkg.dependencies ?? {});
        const violations = declared.filter(function (d) {
            return FORBIDDEN_DEPS.includes(d);
        });
        expect(violations).toEqual([]);
    });
    it('source files do not import from forbidden packages or paths', function () {
        const sources = collectTsFiles(join(PKG_ROOT, 'src'));
        const violations: string[] = [];
        for (const file of sources) {
            const text = readFileSync(file, 'utf-8');
            const importRe = /(?:from\s+|import\s*\(?\s*)['"]([^'"]+)['"]/g;
            let m: RegExpExecArray | null;
            while ((m = importRe.exec(text)) !== null) {
                const spec = m[1] ?? '';
                if (spec === '')
                    continue;
                if (FORBIDDEN_DEPS.includes(spec)) {
                    violations.push(`${file}: forbidden dep ${spec}`);
                    continue;
                }
                if (spec.startsWith('.'))
                    continue; // relative: handled by path-prefix check below
                // Reject deep imports that traverse into forbidden packages by name.
                for (const dep of FORBIDDEN_DEPS) {
                    if (spec === dep || spec.startsWith(`${dep}/`)) {
                        violations.push(`${file}: forbidden subpath import ${spec}`);
                        break;
                    }
                }
            }
            // Reject relative imports that reach into forbidden tree paths.
            // (The envelope-schema.ts intentionally reaches into specs/, which is
            // allowed — that's a published contract, not internal code.)
            const relRe = /from\s+['"]([./][^'"]+)['"]/g;
            let r: RegExpExecArray | null;
            while ((r = relRe.exec(text)) !== null) {
                const rel = r[1] ?? '';
                const normalized = rel.replace(/\\/g, '/');
                for (const prefix of FORBIDDEN_PATH_PREFIXES) {
                    if (normalized.includes(`/${prefix}`) || normalized.startsWith(prefix)) {
                        violations.push(`${file}: forbidden relative import ${rel}`);
                        break;
                    }
                }
            }
        }
        expect(violations).toEqual([]);
    });
});
function collectTsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            out.push(...collectTsFiles(full));
        }
        else if (entry.endsWith('.ts')) {
            out.push(full);
        }
    }
    return out;
}
