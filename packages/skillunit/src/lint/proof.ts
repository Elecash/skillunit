/**
 * The marks of the proof layer that lint can check without a test run: a `proof=<id>` flag names
 * its own unit, once in the skill, and a unit with `Proof: none` has no flagged fence. Whether a
 * test proved the unit is `skillunit proof`'s business.
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

  for (const unit of skill.units) {
    const proof = unit.proof;
    if (!proof) continue;
    const at = (message: string): Problem => ({ file: unit.file, line: proof.line, unit: unit.id, severity: 'error', rule: 'proof', message });
    if (!proof.none) {
      out.push(at('`Proof` takes only `none`, with an optional reason: `Proof: none, a recommendation`. A unit a test proves needs no `Proof` label: the test\'s `[skill:<id>]` tag says it'));
      continue;
    }
    if (unit.proofs.length > 0) {
      const lines = unit.proofs.map((f) => f.line).join(', ');
      out.push(at(`this unit says \`Proof: none\` but has a block with \`proof=\` (line ${lines}); keep one: the test that produces the block, or \`Proof: none\``));
    }
  }
  return out;
}

/** `id` is the unit's id, or the unit's id, a dot and a kebab-case name. */
export function namesUnit(id: string, unit: string): boolean {
  if (id === unit) return true;
  return id.startsWith(`${unit}.`) && NAME.test(id.slice(unit.length + 1));
}
