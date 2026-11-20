// Copies the files the npm package ships but the repository keeps at its root: the README,
// the licence and the Markdown files of the SkillUnit skill (not its specs or tools). Runs on
// `npm pack` and `npm publish`.
import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(pkg, '..', '..');

/** Every `.md` file under `dir`, as paths from the repository root. */
function markdown(dir) {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return name === 'specs' || name === 'tools' ? [] : markdown(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

for (const file of ['README.md', 'LICENSE', ...markdown('skills/skillunit')]) {
  mkdirSync(dirname(join(pkg, file)), { recursive: true });
  cpSync(join(root, file), join(pkg, file));
}
