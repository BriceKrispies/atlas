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

console.log(`Cleared: ${targets.map((t) => `tests/bdd/${t}`).join(', ')}`);
