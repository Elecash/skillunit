/** Pieces the text reporters share: colour, padding, paths, and how a verdict reads. */
import { isAbsolute, join, relative } from 'node:path';
import type { LintSummary, Problem } from '../lint/types.js';
import type { LockReport } from '../proof/layer.js';
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
  const path = join(skill, p.file);
  // A file above the skill folder, such as `skillunit.yaml` or a report, gets its whole path.
  return `${inside(path, options) ?? (p.file.startsWith('../') ? path.split('\\').join('/') : p.file)}:${p.line}`;
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
  return `expected ${v.expect}, got ${v.answer} (${decidingNumber(v, report)}): ${distribution(v, ', ')}`;
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

/** What `--write` or `--forget` did to `skillunit.lock`, shown as `file`, or null when it was not written. */
export function lockChange(lock: LockReport, file: string): string | null {
  if (!lock.written) return null;
  const ids = (list: string[]) => `(${list.join(', ')})`;
  const parts = lock.forgot.length
    ? [`forgot ${plural(lock.forgot.length, 'unit')} ${ids(lock.forgot)}`]
    : [
        lock.added.length ? `added ${plural(lock.added.length, 'unit')} ${ids(lock.added)}` : '',
        lock.dropped.length ? `dropped ${lock.dropped.length} ${ids(lock.dropped)}` : '',
      ].filter(Boolean);
  return `Updated ${file}: ${parts.length ? parts.join(', ') : 'sorted the ids'}.`;
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
      const written = [proof.summary.written ? plural(proof.summary.written, 'block') : '', proof.lock.written ? 'the lock' : ''].filter(Boolean);
      const wrote = written.length ? `, wrote ${written.join(' and ')}` : '';
      parts.push(`proof ${errors || warnings ? `${plural(errors, 'error')}, ${plural(warnings, 'warning')}` : 'ok'}${wrote}`);
    }
  }
  if (test) {
    const s = test.summary;
    const errors = test.specs.filter((x) => x.error).length;
    if (test.dryRun) {
      parts.push(`test dry run ${errors ? `${plural(errors, 'spec')} could not run` : `ok, ${plural(s.tests, 'test')} ready`}`);
    } else {
      const extra = [errors ? `${plural(errors, 'spec')} could not run` : '', s.borderline ? `${s.borderline} borderline` : ''].filter(Boolean);
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
