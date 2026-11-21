/**
 * Every `Source` of a unit exists, as a file or a folder, relative to the source root: the folder
 * of `skillunit.yaml`, or its `sourceRoot`, and a `#name` after a path is a top-level
 * declaration of that file. No git is needed. A code file under a `Source` that the parser cannot
 * read is a warning: its fingerprint keeps its comments until it parses.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fingerprint } from '../sync/fingerprint.js';
import type { ParsedSkill } from '../units/index.js';
import type { Problem } from './types.js';

export function sources(skill: ParsedSkill, sourceRoot: string): Problem[] {
  const out: Problem[] = [];
  for (const unit of skill.units) {
    const line = unit.labels.find((l) => l.name === 'Source')?.line ?? unit.line;
    const at = (message: string, severity: Problem['severity'] = 'error'): Problem => ({ file: unit.file, line, unit: unit.id, severity, rule: 'source', message });
    for (const source of unit.source) {
      if (isAbsolute(source.path)) {
        out.push(at(`\`Source\` ${source.path} is an absolute path; write it relative to the folder of skillunit.yaml, or to its \`sourceRoot\``));
      } else if (!existsSync(resolve(sourceRoot, source.path))) {
        const where = relative(process.cwd(), sourceRoot) || '.';
        out.push(at(`\`Source\` ${source.path} does not exist in ${where}`));
      } else {
        const result = fingerprint(source, sourceRoot);
        if (!result.ok) out.push(at(`\`Source\` ${result.message}`));
        for (const u of result.ok ? result.unparsed : []) {
          out.push(at(`\`Source\` ${u.file} could not be parsed, so a comment edit in it counts as a change until it parses: ${u.error}`, 'warning'));
        }
      }
    }
  }
  return out;
}
