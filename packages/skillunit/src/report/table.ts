/**
 * The default reporter, for people: per layer, one row per file or spec with counts, then one
 * block per failure, the borderline verdicts, the warnings, and a status line. Lint findings
 * come in one block per file, at most `PER_EXAMPLE` per example and each line once, so a skill
 * of fragments stays readable; the JSON report keeps every finding.
 */
import { join } from 'node:path';
import type { Problem } from '../lint/types.js';
import type { SpecReport } from '../test/runner.js';
import { brief, decidingNumber, distribution, painter, pad, padStart, plural, shown, statusLine, undeclaredNames, where } from './text.js';
import type { CheckReport, ReportOptions } from './types.js';

/** Findings shown for one example; the rest are counted. */
export const PER_EXAMPLE = 3;

export function table(report: CheckReport, options: ReportOptions): string {
  const c = painter(options.color);
  const out: string[] = [];
  const mark = (state: 'ok' | 'warn' | 'fail') => (state === 'ok' ? c.green('✓') : state === 'warn' ? c.yellow('~') : c.red('✗'));
  const failures: string[][] = [];
  const warnings: string[] = [];
  const borderline: string[] = [];
  let codes = '';

  /** Lint and sync findings keep the one-line form `file:line  unit-id  what is wrong`. */
  // A message of several lines, such as a command's output, goes on under the finding, indented.
  const problemBlock = (skill: string, p: Problem) => [`${where(skill, p, options)}  ${p.unit ?? '-'}  ${brief(p.message).split('\n').join('\n        ')}`];

  // ---------------------------------------------------------------- lint
  const { lint, sync, test } = report;
  if (lint) {
    out.push('', `${c.bold('Lint')}  ${c.dim(shown(lint.skill, options))}`);
    const rows = lint.files.map((file) => {
      const mine = lint.problems.filter((p) => p.file === file);
      const errors = mine.filter((p) => p.severity === 'error').length;
      return { file, errors, warnings: mine.length - errors };
    });
    // Problems about a file that does not exist (a missing SKILL.md) get a row of their own.
    for (const p of lint.problems) {
      if (!rows.some((r) => r.file === p.file)) rows.push({ file: p.file, errors: p.severity === 'error' ? 1 : 0, warnings: p.severity === 'warning' ? 1 : 0 });
    }
    // A row for each file with a finding; clean files are only counted.
    const found = rows.filter((r) => r.errors || r.warnings);
    const clean = rows.length - found.length;
    const w = Math.max(24, ...found.map((r) => r.file.length)) + 2;
    if (found.length) out.push(c.dim(`    ${pad('FILE', w)}${padStart('ERRORS', 8)}${padStart('WARNINGS', 10)}`));
    for (const r of found) {
      const state = r.errors ? 'fail' : 'warn';
      out.push(`  ${mark(state)} ${pad(r.file, w)}${padStart(String(r.errors), 8)}${padStart(String(r.warnings), 10)}`);
    }
    if (clean) out.push(`  ${mark('ok')} ${found.length ? `${plural(clean, 'other file')} clean` : `${plural(clean, 'file')}, all clean`}`);
    const s = lint.summary;
    const notes = [
      plural(s.units, 'unit'),
      s.typeChecked ? `${plural(s.typeChecked, 'example')} type-checked with TypeScript ${s.typescript}` : '',
      s.notParsed ? `${s.notParsed} did not parse, so their types were not checked` : '',
      s.commandChecked ? `${plural(s.commandChecked, 'example')} run through a command` : '',
      s.noCheck ? `${s.noCheck} marked no-check` : '',
      s.notConfigured ? `${s.notConfigured} ts/js not type-checked: set \`examples.ts\` in skillunit.yaml` : '',
      Object.keys(s.unchecked).length
        ? `not checked, no command set: ${Object.entries(s.unchecked)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([lang, n]) => `${n} ${lang}`)
            .join(', ')}`
        : '',
      s.wrongCode.unchecked ? `${s.wrongCode.unchecked} Wrong code not checked` : '',
      s.off.length ? `off: ${s.off.join(', ')}` : '',
    ].filter(Boolean);
    out.push(c.dim(`  ${notes.join(' · ')}`));
    const line = (p: Problem) => problemBlock(lint.skill, p)[0]!;
    // One failure per file: its first finding, then the others under it.
    for (const lines of byFile(lint.problems.filter((p) => p.severity === 'error'), line)) failures.push([lines[0]!, ...lines.slice(1).map((l) => `   ${l}`)]);
    for (const lines of byFile(lint.problems.filter((p) => p.severity === 'warning'), line)) warnings.push(...lines);
    codes = codeCounts(lint.problems);
  }

  // ---------------------------------------------------------------- sync
  if (sync) {
    out.push('', `${c.bold('Sync')}  ${c.dim(sync.lock.found ? shown(sync.lock.path, options) : `no ${shown(sync.lock.path, options)}`)}`);
    const files = [...new Set(sync.units.map((u) => u.file))];
    const w = Math.max(24, ...files.map((f) => f.length)) + 2;
    if (files.length) {
      out.push(c.dim(`    ${pad('FILE', w)}${padStart('STALE', 7)}${padStart('NEW', 6)}${padStart('IN SYNC', 9)}`));
      for (const file of files) {
        const mine = sync.units.filter((u) => u.file === file);
        const n = (state: string) => mine.filter((u) => u.state === state).length;
        const state = n('stale') || n('new') ? 'fail' : 'ok';
        out.push(`  ${mark(state)} ${pad(file, w)}${padStart(String(n('stale')), 7)}${padStart(String(n('new')), 6)}${padStart(String(n('in-sync')), 9)}`);
      }
    }
    const s = sync.summary;
    const notes = [
      `${plural(s.withSource, 'unit')} with a Source${s.withSource ? `: ${s.inSync} in sync, ${s.stale} stale, ${s.new} new` : ''}`,
      s.orphans ? `${s.orphans} orphan ${s.orphans === 1 ? 'entry' : 'entries'} in the lock` : '',
    ].filter(Boolean);
    out.push(c.dim(`  ${notes.join(' · ')}`));
    for (const p of sync.problems) {
      if (p.severity === 'error') failures.push(problemBlock(sync.skill, p));
      else warnings.push(`${where(sync.skill, p, options)}  ${p.unit ?? '-'}  ${brief(p.message)}`);
    }
  }

  // ---------------------------------------------------------------- proof
  const { proof } = report;
  if (proof && !proof.configured) {
    out.push('', `${c.bold('Proof')}  ${c.dim('not configured: no `proof` key in skillunit.yaml')}`);
  } else if (proof) {
    const reports = proof.reports.length ? proof.reports.map((r) => shown(join(proof.skill, r), options)).join(', ') : 'no report';
    out.push('', `${c.bold('Proof')}  ${c.dim(reports)}`);
    const files = [...new Set(proof.units.map((u) => u.file))];
    const w = Math.max(24, ...files.map((f) => f.length)) + 2;
    const errorsIn = (file: string) => proof.problems.some((p) => p.file === file && p.severity === 'error');
    if (files.length) {
      out.push(c.dim(`    ${pad('FILE', w)}${padStart('PROVED', 8)}${padStart('NONE', 6)}${padStart('PENDING', 9)}${padStart('FAILED', 8)}`));
      for (const file of files) {
        const mine = proof.units.filter((u) => u.file === file);
        const n = (state: string) => mine.filter((u) => u.state === state).length;
        const state = errorsIn(file) || n('failed') ? 'fail' : n('pending') ? 'warn' : 'ok';
        out.push(`  ${mark(state)} ${pad(file, w)}${padStart(String(n('proved')), 8)}${padStart(String(n('none')), 6)}${padStart(String(n('pending')), 9)}${padStart(String(n('failed')), 8)}`);
      }
    }
    const s = proof.summary;
    const notes = [
      `${plural(s.units, 'unit')}: ${s.proved} proved, ${s.none} with Proof: none, ${s.pending} pending${s.failed ? `, ${s.failed} failed` : ''}`,
      `${plural(s.fences, 'block')} from tests${s.written ? `, ${s.written} written` : s.differ ? `, ${s.differ} out of date` : ''}`,
      `${plural(s.tagged, 'tagged test')}`,
      proof.require ? '' : 'require off',
    ].filter(Boolean);
    out.push(c.dim(`  ${notes.join(' · ')}`));
    for (const p of proof.problems) {
      if (p.severity === 'error') failures.push(problemBlock(proof.skill, p));
      else warnings.push(`${where(proof.skill, p, options)}  ${p.unit ?? '-'}  ${brief(p.message)}`);
    }
  }

  // ---------------------------------------------------------------- test
  if (test) {
    const model = test.specs.find((s) => s.model)?.model;
    const label = test.specs.length === 0 ? 'nothing to run' : test.dryRun ? 'dry run: nothing sent' : (model ?? '');
    const since = test.changed ? ` · changed since ${test.changed.ref} (${test.changed.commit.slice(0, 7)})` : '';
    out.push('', `${c.bold('Test')}  ${c.dim(`${label}${since}`)}`);
    const names = test.specs.map((s) => shown(s.spec, options));
    const w = Math.max(24, ...names.map((n) => n.length)) + 2;
    if (test.specs.length === 0) {
      // `test --changed` with nothing changed: no table.
    } else if (test.dryRun) {
      out.push(c.dim(`    ${pad('SPEC', w)}${padStart('TESTS', 7)}${padStart('TOKENS', 9)}`));
    } else {
      out.push(c.dim(`    ${pad('SPEC', w)}${padStart('PASSING', 9)}${padStart('FAILING', 9)}${padStart('ERRORS', 8)}${padStart('BORDERLINE', 12)}`));
    }
    test.specs.forEach((spec, i) => {
      const passing = spec.verdicts.filter((v) => v.pass).length;
      const failing = spec.verdicts.length - passing;
      const near = spec.verdicts.filter((v) => v.borderline).length;
      const state = spec.error || failing ? 'fail' : near ? 'warn' : 'ok';
      if (test.dryRun) {
        const tokens = spec.estimatedTokens ? `~${spec.estimatedTokens.toLocaleString('en-US')}` : '-';
        out.push(`  ${mark(spec.error ? 'fail' : 'ok')} ${pad(names[i]!, w)}${padStart(String(spec.verdicts.length), 7)}${padStart(tokens, 9)}`);
      } else {
        out.push(
          `  ${mark(state)} ${pad(names[i]!, w)}${padStart(String(passing), 9)}${padStart(String(failing), 9)}${padStart(spec.error ? '1' : '0', 8)}${padStart(String(near), 12)}`,
        );
      }
      if (spec.error) failures.push([`${names[i]}  could not run`, `   ${spec.error}`]);
      for (const v of spec.verdicts) {
        const at = `${names[i]}:${v.line ?? 1}  ${v.id}`;
        if (!v.pass) failures.push(testFailure(spec, v, at, report, options));
        else if (v.borderline) borderline.push(`${at}  ${v.answer}, ${decidingNumber(v, report)}`);
      }
    });
    const s = test.summary;
    const notes = [
      plural(s.tests, 'test'),
      s.skipped ? `${plural(s.skipped, 'spec')} left out by --changed` : '',
      test.dryRun || s.tests === 0 ? '' : `${s.usage.input_tokens.toLocaleString('en-US')} in / ${s.usage.output_tokens.toLocaleString('en-US')} out tokens`,
    ].filter(Boolean);
    out.push(c.dim(`  ${notes.join(' · ')}`));
  }

  // ---------------------------------------------------------------- details
  if (failures.length) {
    out.push('', c.bold(c.red('Failures')));
    failures.forEach((block, i) => out.push('', `  ${i + 1}) ${block[0]}`, ...block.slice(1).map((l) => `  ${l}`)));
  }
  if (borderline.length) {
    const margin = report.test?.thresholds.margin;
    out.push('', `${c.bold(c.yellow('Borderline'))}  ${c.dim(`passed, but within ${margin} of the threshold; the next run may fail them`)}`);
    out.push(...borderline.map((l) => `  ${l}`));
  }
  if (warnings.length) out.push('', c.bold(c.yellow('Warnings')), ...warnings.map((l) => `  ${l}`));
  if (codes) out.push('', c.dim(`Type problems by code: ${codes}`));
  const names = lint ? undeclaredNames(lint.summary) : null;
  if (names) out.push(...(codes ? [] : ['']), ...names);

  out.push('', report.ok ? c.green(statusLine(report)) : c.red(statusLine(report)), '');
  return out.join('\n');
}

function testFailure(spec: SpecReport, v: SpecReport['verdicts'][number], at: string, report: CheckReport, options: ReportOptions): string[] {
  const skill = report.test!.skill;
  const part = spec.sections.length ? `${spec.file} › ${spec.sections.join(' + ')}` : spec.file;
  const dir = shown(skill, options);
  const skillLine = `${dir === '.' ? '' : `${dir}/`}${part}${v.unit ? `   unit: ${v.unit}` : ''}`;
  const verdict = `${v.weak ? 'right answer, too little confidence' : 'wrong answer'}${v.borderline ? ', borderline: the next run may pass it' : ''}`;
  return [
    at,
    `   skill:     ${skillLine}`,
    `   scenario:  ${v.scenario}`,
    `   question:  ${v.question}`,
    `   expected:  ${v.expect}`,
    `   got:       ${v.answer} · ${decidingNumber(v, report)} · ${verdict}`,
    `              ${distribution(v)}`,
    ...(v.variants ? [`   phrasings: ${v.variants.map((p) => p.toFixed(2)).join('  ')} (probability of "${v.expect}" for each; the median decides)`] : []),
  ];
}

/**
 * Lint findings as one block per file: each line and message once, and at most `PER_EXAMPLE`
 * findings per example, with the rest counted under the last one shown.
 */
function byFile(problems: Problem[], line: (p: Problem) => string): string[][] {
  const files = new Map<string, Problem[]>();
  for (const p of problems) files.set(p.file, [...(files.get(p.file) ?? []), p]);
  return [...files.values()].map((list) => {
    const lines: string[] = [];
    const seen = new Set<string>();
    const shown = new Map<number, number>();
    const hidden = new Map<number, number>();
    const lastShown = new Map<number, number>();
    for (const p of list) {
      const key = `${p.line}\0${p.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (p.example !== undefined) {
        const n = shown.get(p.example) ?? 0;
        if (n >= PER_EXAMPLE) {
          hidden.set(p.example, (hidden.get(p.example) ?? 0) + 1);
          continue;
        }
        shown.set(p.example, n + 1);
        lastShown.set(p.example, lines.length);
      }
      lines.push(line(p));
    }
    // From the end, so the indexes still point at the right lines.
    const notes = [...hidden].map(([example, n]) => ({ at: lastShown.get(example)!, text: `  +${n} more in this example` }));
    for (const note of notes.sort((a, b) => b.at - a.at)) lines.splice(note.at + 1, 0, note.text);
    return lines;
  });
}

/** `TS2304 512 · TS2322 40`: the type problems by code, the most frequent first. */
function codeCounts(problems: Problem[]): string {
  const counts = new Map<string, number>();
  for (const p of problems) if (p.code) counts.set(p.code, (counts.get(p.code) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code, n]) => `${code} ${n}`)
    .join(' · ');
}
