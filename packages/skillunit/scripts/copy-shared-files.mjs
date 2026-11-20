// Copies the files the npm package ships but the repository keeps at its root: the README,
// the licence and the SkillUnit skill. Runs on `npm pack` and `npm publish`.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(pkg, '..', '..');

for (const file of ['README.md', 'LICENSE', 'skills/skillunit/SKILL.md']) {
  mkdirSync(dirname(join(pkg, file)), { recursive: true });
  cpSync(join(root, file), join(pkg, file));
}
