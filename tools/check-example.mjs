// Checks one example of the SkillUnit skill, as `examples` in the root skillunit.yaml asks: a
// Markdown example must parse with SkillUnit's own unit parser, and a YAML example must be
// valid YAML. Needs `npx nx build skillunit` first.
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { parseFile } from '../packages/skillunit/dist/units/index.js';

const [kind, file] = process.argv.slice(2);
const text = readFileSync(file, 'utf8');
if (kind === 'md') {
  const { errors } = parseFile(text, 'example.md');
  for (const e of errors) console.error(`line ${e.line}: ${e.message}`);
  process.exit(errors.length ? 1 : 0);
}
if (kind === 'yaml') {
  try {
    parse(text);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
