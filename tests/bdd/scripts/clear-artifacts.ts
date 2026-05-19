import { rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = join(process.cwd(), 'tests', 'bdd');
const targets = ['screenshots', 'report'];
for (const dir of targets) {
    const path = join(root, dir);
    await rm(path, { recursive: true, force: true });
    await mkdir(path, { recursive: true });
    await writeFile(join(path, '.gitkeep'), '');
}
// eslint-disable-next-line no-console -- cli-stdout: BDD prep script's user-visible status line; runs ahead of the harness so the structured logger isn't booted yet
console.log(`Cleared: ${targets.map(function (t) {
    return `tests/bdd/${t}`;
}).join(', ')}`);
