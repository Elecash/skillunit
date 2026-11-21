/** Pieces the text reporters share: colour, padding, paths, and how a verdict reads. */
import { basename, isAbsolute, join, relative } from 'node:path';
import type { Problem } from '../lint/types.js';
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
 * Where a lint or sync problem is, for people: `skills/x/SKILL.md:12` from the folder the command
 * ran in, or from the skill folder, which the layer's header names, when the skill is outside it.
 */
export function where(skill: string, p: Problem, options: ReportOptions): string {
  const path = join(skill, p.file);
  // A file above the skill folder, such as a lock next to `skillunit.yaml`, gets its whole path.
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

/** The number that decided the verdict, and what it was compared with. */
export function decidingNumber(v: Verdict, report: CheckReport): string {
  const th = report.test?.thresholds;
  if (v.probabilities) {
    return `confidence ${v.confidence.toFixed(2)}${th ? `, threshold ${th.choice.toFixed(2)}` : ''}`;
  }
  const threshold = th ? (v.expect === 'yes' ? `, needs ≥ ${th.yes.toFixed(2)}` : `, needs ≤ ${th.no.toFixed(2)}`) : '';
  return `P(yes) ${v.confidence.toFixed(2)}${threshold}`;
}

/** One line on how each layer went, for the end of every text report. */
export function statusLine(report: CheckReport): string {
  const parts: string[] = [];
  const { lint, sync, test } = report;
  if (lint) {
    const errors = lint.problems.filter((p) => p.severity === 'error').length;
    const warnings = lint.problems.length - errors;
    parts.push(`lint ${errors || warnings ? `${plural(errors, 'error')}, ${plural(warnings, 'warning')}` : 'ok'}`);
  }
  if (sync) {
    const review = sync.summary.stale + sync.summary.new;
    const orphans = sync.summary.orphans ? `, ${sync.summary.orphans} orphan ${sync.summary.orphans === 1 ? 'entry' : 'entries'}` : '';
    if (!sync.lock.found && sync.summary.withSource) parts.push(`sync no ${basename(sync.lock.path)}`);
    else parts.push(`sync ${review ? `${plural(review, 'unit')} to review` : 'ok'}${orphans}`);
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
  return message.length <= max ? message : `${message.slice(0, max - 1).trimEnd()}…`;
}
