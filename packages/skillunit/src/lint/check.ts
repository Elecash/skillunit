/**
 * Lint item 2, `Check`: every `forbid` regex runs on every fence whose language it lists and on
 * every inline code span of the skill (a span has no language), skipping `Wrong` items. It runs
 * on the code as written, without `Setup`. Also the self-test of item 5: a `forbid` that matches
 * none of its own unit's `Wrong` code guards nothing.
 */
import type { Check, ParsedSkill, Unit } from '../units/index.js';
import { ownerUnit, snippet, type WrongCode } from './examples.js';
import type { Problem } from './types.js';

export function checks(skill: ParsedSkill, wrong: WrongCode[]): Problem[] {
  const out: Problem[] = [];
  const units = skill.units.filter((u) => u.check.length > 0);

  for (const file of skill.files) {
    for (const fence of file.fences) {
      if (fence.owner.kind === 'wrong' || fence.owner.kind === 'skipped') continue;
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
      if (span.owner.kind === 'unit' && span.owner.label === 'Wrong') continue;
      const owner = span.owner.kind === 'unit' ? span.owner.unit : undefined;
      for (const unit of units) {
        for (const check of unit.check) {
          const m = check.regex.exec(span.code);
          if (m) out.push(finding(file.file, span.line, owner, unit, check, m[0]));
        }
      }
    }
  }

  for (const unit of units) {
    const own = wrong.filter((w) => w.unit === unit);
    for (const check of unit.check) {
      const candidates = own.filter((w) => w.lang !== null && check.langs.includes(w.lang));
      if (candidates.length > 0 && !candidates.some((w) => check.regex.test(w.code))) {
        out.push({
          file: unit.file,
          line: check.line,
          unit: unit.id,
          severity: 'error',
          rule: 'check',
          message: `this \`Check\` matches none of the unit's \`Wrong\` code, so it guards nothing; fix the regex`,
        });
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

/** Whether a `forbid` Check of the unit matches this `Wrong` code. */
export function guardedByCheck(w: WrongCode): boolean {
  return w.lang !== null && w.unit.check.some((c) => c.langs.includes(w.lang!) && c.regex.test(w.code));
}
