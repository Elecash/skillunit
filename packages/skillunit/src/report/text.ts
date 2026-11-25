/** Pieces the text reporters share: colour, padding, paths, and how a verdict reads. */
import { isAbsolute, join, relative } from 'node:path';
import type { LintSummary, Problem } from '../lint/types.js';
import type { ProofResult } from '../proof/layer.js';
import type { Verdict } from '../test/reader.js';
import type { CheckReport, ReportOptions } from './types.js';

/**
 * Colour is on when stdout is a terminal, off with NO_COLOR or TERM=dumb, and forced on with
 * FORCE_COLOR. Plain ANSI codes, no dependency.
 */
export function colorByDefault(): boolean {
  if (process.env.FORCE_COLOR !== undefined) return process.env.FORCE_COLOR !== '0';
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';
}

export function painter(color: boolean) {
  const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { bold: paint('1'), dim: paint('2'), red: paint('31'), green: paint('32'), yellow: paint('33') };
}

/** Length as shown on screen, without the ANSI codes. */
export const width = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
export const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - width(s)));
export const padStart = (s: string, n: number) => ' '.repeat(Math.max(0, n - width(s))) + s;
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const pct = (p: number) => `${Math.round(p * 100)}%`;

/** `path` from the folder the command ran in, with `/`, or null when that needs `..`. */
function inside(path: string, options: ReportOptions): string | null {
  const rel = relative(options.cwd, path).split('\\').join('/');
  return rel === '..' || rel.startsWith('../') || isAbsolute(rel) ? null : rel || '.';
}

/**
 * A path for people: from the folder the command ran in, or the whole path when it is outside
 * that folder, where a run of `../` would only hide where it is.
 */
export function shown(path: string, options: ReportOptions): string {
  return inside(path, options) ?? path.split('\\').join('/');
}

/**
 * Where a lint or proof problem is, for people: `skills/x/SKILL.md:12` from the folder the command
 * ran in, or from the skill folder, which the layer's header names, when the skill is outside it.
 */
export function where(skill: string, p: Problem, options: ReportOptions): string {
  return `${skillFile(skill, p.file, options)}:${p.line}`;
}

/** A file of the skill (`file` from the skill folder) for people, from the same place as `where`. */
export function skillFile(skill: string, file: string, options: ReportOptions): string {
  const path = join(skill, file);
  // A file above the skill folder, such as `skillunit.yaml` or a report, gets its whole path.
  return inside(path, options) ?? (file.startsWith('../') ? path.split('\\').join('/') : file);
}

/** Options from most to least likely, e.g. "stop 96% · none 3% · local 1%". */
export function distribution(v: Verdict, sep = ' · '): string {
  const entries = v.probabilities ? Object.entries(v.probabilities) : [['yes', v.confidence] as const, ['no', 1 - v.confidence] as const];
  return [...entries]
    .sort((a, b) => b[1] - a[1])
    .map(([label, p]) => `${label} ${pct(p)}`)
    .join(sep);
}

/** What a failed or borderline verdict got, on one line, for the JUnit and GitHub reports. */
export function gotLine(v: Verdict, report: CheckReport): string {
  if (v.refused) return `expected ${v.expect}; the model refused to answer`;
  const tie = v.tied ? ', and a tie does not pass' : '';
  return `expected ${v.expect}, got ${answered(v)} (${decidingNumber(v, report)}${tie}): ${distribution(v, ', ')}`;
}

/** The answer a verdict got: an option, yes or no, or `a tie of stop and none`. */
export function answered(v: Verdict): string {
  if (!v.tied) return v.answer;
  return `a tie of ${v.tied.slice(0, -1).join(', ')} and ${v.tied[v.tied.length - 1]}`;
}

/** The number that decided the verdict, and what it was compared with. */
export function decidingNumber(v: Verdict, report: CheckReport): string {
  const th = report.test?.thresholds;
  if (v.probabilities) {
    return `probability ${v.confidence.toFixed(2)}${th ? `, threshold ${th.choice.toFixed(2)}` : ''}`;
  }
  const threshold = th ? (v.expect === 'yes' ? `, needs ≥ ${th.yes.toFixed(2)}` : `, needs ≤ ${th.no.toFixed(2)}`) : '';
  return `P(yes) ${v.confidence.toFixed(2)}${threshold}`;
}

/** What `proof --write` did to the skill folder, or null when it wrote nothing. */
export function buildChange(proof: ProofResult, options: ReportOptions): string | null {
  const written = proof.files.filter((f) => f.state === 'written');
  if (!written.length) return null;
  const names = written.slice(0, 5).map((f) => f.file).join(', ') + (written.length > 5 ? ', …' : '');
  return `Wrote ${plural(written.length, 'file')} of ${shown(proof.skill, options)}: ${names}.`;
}

/**
 * Where the line of a finding comes from, when the skill is built: the test of a unit, or a file
 * of the source. Null for a skill that is not built.
 */
export function originOf(skill: string, p: Problem, options: ReportOptions): string | null {
  if (!p.origin) return null;
  const place = `${skillFile(skill, p.origin.file, options)}:${p.origin.line}`;
  return p.origin.kind === 'test' ? `the test of \`${p.origin.unit}\`, ${place}` : `the source, ${place}`;
}

/** The message of a finding, with where its line comes from. */
export function withOrigin(skill: string, p: Problem, options: ReportOptions): string {
  const origin = originOf(skill, p, options);
  return origin ? `${p.message}\nfrom ${origin}` : p.message;
}

/** The proof in one line: `12 units · 9 proved by a test · 3 declared without one · 2 values in prose`, and what is wrong. */
export function proofSummary(proof: ProofResult): string {
  const s = proof.summary;
  return [
    plural(s.units, 'unit'),
    `${s.proved} proved by a test${s.failed ? `, ${s.failed} failed` : ''}${s.missing ? `, ${s.missing} missing` : ''}`,
    `${s.declared} declared without one`,
    `${plural(s.values, 'value')} in prose`,
    s.written ? `${plural(s.written, 'file')} written` : s.differ ? `${plural(s.differ, 'file')} out of date` : '',
    s.extra ? `${plural(s.extra, 'file')} the source does not build` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * For a model test about a unit of a built skill: where the unit is declared, so a failure says
 * which file to edit. Null when the skill is not built.
 */
export function unitOrigin(report: CheckReport, unit: string | undefined, options: ReportOptions): string | null {
  const u = unit === undefined ? undefined : report.units?.find((x) => x.id === unit);
  if (!u?.test) return null;
  const skill = report.lint?.skill ?? (report.proof?.configured ? report.proof.skill : undefined) ?? report.test?.skill ?? '';
  const place = `${skillFile(skill, u.test.file, options)}:${u.test.line}`;
  return u.from === 'declared' ? `the unit \`${u.id}\` is declared, with no test, at ${place}` : `the unit \`${u.id}\` comes from its test, ${place}`;
}

/** One line on how each layer went, for the end of every text report. */
export function statusLine(report: CheckReport): string {
  const parts: string[] = [];
  const { lint, proof, test } = report;
  if (lint) {
    const errors = lint.problems.filter((p) => p.severity === 'error').length;
    const warnings = lint.problems.length - errors;
    parts.push(`lint ${errors || warnings ? `${plural(errors, 'error')}, ${plural(warnings, 'warning')}` : 'ok'}`);
  }
  if (proof) {
    if (!proof.configured) parts.push('proof not configured');
    else {
      const errors = proof.problems.filter((p) => p.severity === 'error').length;
      const warnings = proof.problems.length - errors;
      const wrote = proof.summary.written ? `, wrote ${plural(proof.summary.written, 'file')}` : '';
      parts.push(`proof ${errors || warnings ? `${plural(errors, 'error')}, ${plural(warnings, 'warning')}` : 'ok'}${wrote}`);
    }
  }
  if (test) {
    const s = test.summary;
    const errors = test.requests.filter((x) => x.error).length;
    const wrong = [errors ? `${plural(errors, 'request')} could not run` : '', test.problems.length ? plural(test.problems.length, 'problem') : ''].filter(Boolean).join(', ');
    if (test.dryRun) {
      parts.push(`test dry run ${wrong || `ok, ${plural(s.tests, 'test')} ready`}`);
    } else {
      const extra = [wrong, s.borderline ? `${s.borderline} borderline` : ''].filter(Boolean);
      parts.push(`test ${s.passed}/${s.tests} passed${extra.length ? ` (${extra.join(', ')})` : ''}`);
    }
  }
  return `${report.ok ? 'OK' : 'FAILED'}  ${parts.join(' · ')}`;
}

/**
 * A message cut to `max` characters for a terminal. A `tsc` message with its continuation
 * lines can run to thousands; the JSON report keeps it whole.
 */
export function brief(message: string, max = 400): string {
  return message
    .split('\n')
    .map((line) => (line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`))
    .join('\n');
}

/** Where a skill declares the names its examples use. */
export const SETUP_DOCS = 'https://github.com/Elecash/skillunit/blob/main/docs/style-guide.md#setup';

/**
 * The names no example or `Setup` declares, the five most frequent with their counts, and where
 * to declare them: two lines, or none when every name is declared.
 */
export function undeclaredNames(summary: LintSummary): [string, string] | null {
  const names = summary.undeclared;
  if (!names.length) return null;
  const top = names.slice(0, 5).map((n) => `${n.name} ${n.count}`).join(' · ');
  const more = names.length > 5 ? `, and ${names.length - 5} more` : '';
  return [`Names nothing declares: ${top}${more}`, `A \`Setup:\` block in \`SKILL.md\` declares them once for every file of the skill: ${SETUP_DOCS}`];
}
