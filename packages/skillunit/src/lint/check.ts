/**
 * Lint item 2, `Check`: every `forbid` regex runs on every fence whose language it lists and on
 * every inline code span of the skill (a span has no language). It runs on the code as written,
 * without `Setup`.
 */
import type { Check, ParsedSkill, Unit } from '../units/index.js';
import { ownerUnit, snippet } from './examples.js';
import type { Problem } from './types.js';

export function checks(skill: ParsedSkill): Problem[] {
  const out: Problem[] = [];
  const units = skill.units.filter((u) => u.check.length > 0);

  for (const file of skill.files) {
    for (const fence of file.fences) {
      if (fence.owner.kind === 'skipped') continue;
      for (const unit of units) {
        for (const check of unit.check) {
          if (!check.langs.includes(fence.lang)) continue;
          const m = check.regex.exec(fence.code);
          if (!m) continue;
          const line = fence.line + 1 + (fence.code.slice(0, m.index).match(/\n/g)?.length ?? 0);
          out.push(finding(file.file, line, ownerUnit(fence.owner), unit, check, m[0]));
        }
      }
    }
    for (const span of file.inlineCode) {
      const owner = span.owner.kind === 'unit' ? span.owner.unit : undefined;
      for (const unit of units) {
        for (const check of unit.check) {
          const m = check.regex.exec(span.code);
          if (m) out.push(finding(file.file, span.line, owner, unit, check, m[0]));
        }
      }
    }
  }

  return out;
}

function finding(file: string, line: number, owner: string | undefined, unit: Unit, check: Check, match: string): Problem {
  const p: Problem = {
    file,
    line,
    severity: 'error',
    rule: 'check',
    message: `breaks \`${unit.id}\`: \`${snippet(match)}\` matches its \`Check\` (${unit.file}:${check.line})`,
  };
  if (owner) p.unit = owner;
  return p;
}
