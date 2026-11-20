/**
 * Every `Source` of a unit exists, as a file or a folder, relative to the source root: the folder
 * of `skillunit.yaml`, or its `sourceRoot`. No git is needed.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ParsedSkill } from '../units/index.js';
import type { Problem } from './types.js';

export function sources(skill: ParsedSkill, sourceRoot: string): Problem[] {
  const out: Problem[] = [];
  for (const unit of skill.units) {
    const line = unit.labels.find((l) => l.name === 'Source')?.line ?? unit.line;
    const at = (message: string): Problem => ({ file: unit.file, line, unit: unit.id, severity: 'error', rule: 'source', message });
    for (const source of unit.source) {
      if (isAbsolute(source.path)) {
        out.push(at(`\`Source\` ${source.path} is an absolute path; write it relative to the folder of skillunit.yaml, or to its \`sourceRoot\``));
      } else if (!existsSync(resolve(sourceRoot, source.path))) {
        const where = relative(process.cwd(), sourceRoot) || '.';
        out.push(at(`\`Source\` ${source.path} does not exist in ${where}`));
      }
    }
  }
  return out;
}
