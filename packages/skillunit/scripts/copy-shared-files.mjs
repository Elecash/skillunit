// Copies the files the npm package ships but the repository keeps at its root: the README,
// the licence, the docs, so they can be read offline, and the SkillUnit skill, which holds only
// what an agent reads (its settings and its source are at the repository root). Runs on
// `npm pack` and `npm publish`.
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(pkg, '..', '..');

/** Every `.md` file under `dir`, as paths from the repository root. */
function markdown(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return markdown(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

// The copies of an earlier run go first, so a page removed from the repository is not shipped.
for (const dir of ['docs', 'skills']) rmSync(join(pkg, dir), { recursive: true, force: true });

for (const file of ['README.md', 'LICENSE', ...markdown('docs'), ...markdown('skills/skillunit')]) {
  mkdirSync(dirname(join(pkg, file)), { recursive: true });
  cpSync(join(root, file), join(pkg, file));
}
