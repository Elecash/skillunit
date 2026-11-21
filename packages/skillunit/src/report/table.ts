/**
 * The default reporter, for people: per layer, one row per file or spec with counts, then one
 * block per failure, the borderline verdicts, the warnings, and a status line.
 */
import type { Problem } from '../lint/types.js';
import type { SpecReport } from '../test/runner.js';
import { decidingNumber, distribution, painter, pad, padStart, plural, shown, statusLine, where } from './text.js';
import type { CheckReport, ReportOptions } from './types.js';

export function table(report: CheckReport, options: ReportOptions): string {
  const c = painter(options.color);
  const out: string[] = [];
  const mark = (state: 'ok' | 'warn' | 'fail') => (state === 'ok' ? c.green('✓') : state === 'warn' ? c.yellow('~') : c.red('✗'));
  const failures: string[][] = [];
  const warnings: string[] = [];
  const borderline: string[] = [];

  /** Lint and sync findings keep the one-line form `file:line  unit-id  what is wrong`. */
  const problemBlock = (skill: string, p: Problem) => [`${where(skill, p, options)}  ${p.unit ?? '-'}  ${p.message}`];

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
    const w = Math.max(24, ...rows.map((r) => r.file.length)) + 2;
    out.push(c.dim(`    ${pad('FILE', w)}${padStart('ERRORS', 8)}${padStart('WARNINGS', 10)}`));
    for (const r of rows) {
      const state = r.errors ? 'fail' : r.warnings ? 'warn' : 'ok';
      out.push(`  ${mark(state)} ${pad(r.file, w)}${padStart(String(r.errors), 8)}${padStart(String(r.warnings), 10)}`);
    }
    const s = lint.summary;
    const notes = [
      plural(s.units, 'unit'),
      s.typeChecked ? `${plural(s.typeChecked, 'example')} type-checked with TypeScript ${s.typescript}` : '',
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
    ].filter(Boolean);
    out.push(c.dim(`  ${notes.join(' · ')}`));
    for (const p of lint.problems) {
      if (p.severity === 'error') failures.push(problemBlock(lint.skill, p));
      else warnings.push(`${where(lint.skill, p, options)}  ${p.unit ?? '-'}  ${p.message}`);
    }
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
      else warnings.push(`${where(sync.skill, p, options)}  ${p.unit ?? '-'}  ${p.message}`);
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
