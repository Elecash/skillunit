/**
 * The marks of the proof layer that lint can check without a test run: a `proof=<id>` flag names
 * its own unit, once in the skill. Whether a test proved the unit is `skillunit proof`'s business.
 */
import type { Fence, ParsedSkill } from '../units/index.js';
import type { Problem } from './types.js';

/** The part after `<unit id>.` when a unit has several proved examples. */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function proofMarks(skill: ParsedSkill): Problem[] {
  const out: Problem[] = [];
  const seen = new Map<string, Fence>();

  for (const file of skill.files) {
    for (const fence of file.fences) {
      if (fence.proof === undefined) continue;
      const at = (message: string): Problem => {
        const p: Problem = { file: file.file, line: fence.line, severity: 'error', rule: 'proof', message };
        if ('unit' in fence.owner) p.unit = fence.owner.unit;
        return p;
      };
      if (!('unit' in fence.owner)) {
        out.push(at(`\`proof=${fence.proof}\` is on a block that belongs to no unit; a test proves the example of a unit, so the flag goes on a fence inside one`));
        continue;
      }
      const unit = fence.owner.unit;
      if (fence.flags.filter((f) => f.startsWith('proof=')).length > 1) {
        out.push(at('this block has two `proof=` flags; one block is one example, produced by one test'));
      }
      if (!fence.proof) {
        out.push(at(`\`proof=\` needs an id: \`proof=${unit}\`, or \`proof=${unit}.<name>\` when the unit has several proved examples`));
        continue;
      }
      if (!namesUnit(fence.proof, unit)) {
        out.push(at(`\`proof=${fence.proof}\` does not name this block's unit; a fence of \`${unit}\` takes \`proof=${unit}\`, or \`proof=${unit}.<name>\` with a kebab-case name`));
        continue;
      }
      const first = seen.get(fence.proof);
      if (first) {
        out.push(at(`\`proof=${fence.proof}\` is also on the block at ${first.file}:${first.line}; each proved example has an id of its own`));
      } else {
        seen.set(fence.proof, fence);
      }
    }
  }
  return out;
}

/** `id` is the unit's id, or the unit's id, a dot and a kebab-case name. */
export function namesUnit(id: string, unit: string): boolean {
  if (id === unit) return true;
  return id.startsWith(`${unit}.`) && NAME.test(id.slice(unit.length + 1));
}
