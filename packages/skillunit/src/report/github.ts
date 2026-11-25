/**
 * GitHub Actions workflow commands: each finding becomes an annotation on its file and line in
 * the pull request, then a status line ends the log. Errors fail the check; warnings and
 * borderline verdicts do not.
 */
import { join } from 'node:path';
import type { Problem } from '../lint/types.js';
import { buildChange, gotLine, proofSummary, shown, statusLine, undeclaredNames, unitOrigin, withOrigin } from './text.js';
import type { CheckReport, ReportOptions } from './types.js';

export function github(report: CheckReport, options: ReportOptions): string {
  // Annotation paths start at the repository's root, the way GitHub names a file of the
  // repository, even when the command ran in a subfolder. Messages keep paths from `cwd`.
  const at = { ...options, cwd: options.root ?? options.cwd };
  const out: string[] = [];
  const annotate = (level: 'error' | 'warning', file: string, line: number, title: string, message: string) =>
    out.push(`::${level} file=${prop(file)},line=${line},title=${prop(title)}::${data(message)}`);
  const problem = (layer: string, skill: string, p: Problem) =>
    annotate(p.severity, shown(join(skill, p.file), at), p.line, `SkillUnit ${layer}${p.unit ? `: ${p.unit}` : ''}`, withOrigin(skill, p, options));

  if (report.lint) for (const p of report.lint.problems) problem('lint', report.lint.skill, p);
  if (report.proof?.configured) for (const p of report.proof.problems) problem('proof', report.proof.skill, p);
  if (report.test) {
    // A question is annotated where it is declared: the line of its `unit()` or `ask()`.
    for (const p of report.test.problems) {
      const title = `SkillUnit test${p.id ? `: ${p.id}` : ''}`;
      if (p.declared) annotate('error', shown(p.declared.file, at), p.declared.line, title, p.message);
      else out.push(`::error title=${prop(title)}::${data(p.message)}`);
    }
    for (const r of report.test.requests) {
      if (r.error) {
        const first = r.questions?.[0];
        const message = `could not ask the questions about ${r.file}: ${r.error}`;
        if (first) annotate('error', shown(first.declared.file, at), first.declared.line, 'SkillUnit test', message);
        else out.push(`::error title=SkillUnit test::${data(message)}`);
      }
      for (const v of r.verdicts) {
        const got = gotLine(v, report);
        const origin = unitOrigin(report, v.unit, options);
        const file = v.declared ? shown(v.declared.file, at) : shown(join(report.test.skill, r.file), at);
        const line = v.declared?.line ?? 1;
        if (!v.pass) annotate('error', file, line, `SkillUnit test: ${v.id}`, `${got}\nscenario: ${v.scenario}${origin ? `\n${origin}` : ''}`);
        else if (v.borderline) annotate('warning', file, line, `SkillUnit test: ${v.id} is borderline`, `passed near its threshold, so a later run may fail it: ${got}`);
      }
    }
  }
  const { proof } = report;
  const change = proof?.configured ? buildChange(proof, options) : null;
  if (proof?.configured) out.push(`::notice title=SkillUnit proof::${data(proofSummary(proof))}`);
  if (change) out.push(`::notice title=SkillUnit proof::${data(change)}`);
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
