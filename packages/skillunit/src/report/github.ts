/**
 * GitHub Actions workflow commands: each finding becomes an annotation on its file and line in
 * the pull request, then a status line ends the log. Errors fail the check; warnings and
 * borderline verdicts do not.
 */
import { join } from 'node:path';
import type { Problem } from '../lint/types.js';
import { decidingNumber, distribution, shown, statusLine, undeclaredNames } from './text.js';
import type { CheckReport, ReportOptions } from './types.js';

export function github(report: CheckReport, options: ReportOptions): string {
  const out: string[] = [];
  const annotate = (level: 'error' | 'warning', file: string, line: number, title: string, message: string) =>
    out.push(`::${level} file=${prop(file)},line=${line},title=${prop(title)}::${data(message)}`);
  const problem = (layer: string, skill: string, p: Problem) =>
    annotate(p.severity, shown(join(skill, p.file), options), p.line, `SkillUnit ${layer}${p.unit ? `: ${p.unit}` : ''}`, p.message);

  if (report.lint) for (const p of report.lint.problems) problem('lint', report.lint.skill, p);
  if (report.proof?.configured) for (const p of report.proof.problems) problem('proof', report.proof.skill, p);
  if (report.test) {
    for (const spec of report.test.specs) {
      const file = shown(spec.spec, options);
      if (spec.error) annotate('error', file, 1, 'SkillUnit test', `could not run: ${spec.error}`);
      for (const v of spec.verdicts) {
        const got = `expected ${v.expect}, got ${v.answer} (${decidingNumber(v, report)}): ${distribution(v, ', ')}`;
        if (!v.pass) annotate('error', file, v.line ?? 1, `SkillUnit test: ${v.id}`, `${got}\nscenario: ${v.scenario}`);
        else if (v.borderline) annotate('warning', file, v.line ?? 1, `SkillUnit test: ${v.id} is borderline`, `passed near its threshold, so a later run may fail it: ${got}`);
      }
    }
  }
  const names = report.lint ? undeclaredNames(report.lint.summary) : null;
  if (names) out.push(`::notice title=SkillUnit lint::${data(`${names[0]}. ${names[1]}`)}`);
  out.push(statusLine(report), '');
  return out.join('\n');
}

/** Escaping for the message of a workflow command. */
function data(s: string): string {
  return s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/** Escaping for a property of a workflow command (`file`, `title`). */
function prop(s: string): string {
  return data(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
}
