/**
 * The default reporter, for people. `lint` alone prints one row per file with findings, then one
 * block per failure, the warnings, and a status line. The other commands print the report by
 * unit (`units.ts`): each file of the skill, each unit in it, and under the unit the lines of
 * each layer, each failure with its details under it. Then an index of what failed, so the end
 * of the output, which is what a terminal shows, names it. Lint findings come at most
 * `PER_EXAMPLE` per example and each line once, so a skill of fragments stays readable; the
 * JSON report keeps every finding.
 */
import { join } from 'node:path';
import type { LintResult, Problem } from '../lint/types.js';
import type { RunReport } from '../proof/layer.js';
import type { Verdict } from '../test/reader.js';
import type { SpecReport } from '../test/runner.js';
import { brief, buildChange, decidingNumber, proofSummary, distribution, painter, pad, padStart, plural, shown, skillFile, statusLine, undeclaredNames, where, withOrigin } from './text.js';
import type { CheckReport, ReportOptions } from './types.js';
import { compact, layerOf, unitTree, type Line, type Mark, type UnitNode, type UnitTree } from './units.js';

type Painter = ReturnType<typeof painter>;

export function table(report: CheckReport, options: ReportOptions): string {
  const c = painter(options.color);
  const out: string[] = [];
  const { lint } = report;
  if (lint) out.push(...lintBlock(lint, options, c));
  const failed = report.command === 'lint' ? lintFailures(report, options, c, out) : byUnit(report, options, c, out);

  const codes = lint ? codeCounts(lint.problems) : '';
  if (codes) out.push('', c.dim(`Type problems by code: ${codes}`));
  const names = lint ? undeclaredNames(lint.summary) : null;
  if (names) out.push(...(codes ? [] : ['']), ...names);
  if (failed.length) out.push('', c.bold(c.red('Failed')), ...failed.map((f) => `  ${f}`));

  out.push('', report.ok ? c.green(statusLine(report)) : c.red(statusLine(report)), '');
  return out.join('\n');
}

const sign = (c: Painter, mark: Mark) =>
  mark === 'pass' ? c.green('✓') : mark === 'fail' ? c.red('✗') : mark === 'warn' ? c.yellow('~') : mark === 'none' ? c.dim('–') : c.dim('·');

// ---------------------------------------------------------------- lint

/** The header, one row per file with findings, and what was checked. */
function lintBlock(lint: LintResult, options: ReportOptions, c: Painter): string[] {
  const out = ['', `${c.bold('Lint')}  ${c.dim(shown(lint.skill, options))}`];
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
    out.push(`  ${sign(c, r.errors ? 'fail' : 'warn')} ${pad(r.file, w)}${padStart(String(r.errors), 8)}${padStart(String(r.warnings), 10)}`);
  }
  if (clean) out.push(`  ${sign(c, 'pass')} ${found.length ? `${plural(clean, 'other file')} clean` : `${plural(clean, 'file')}, all clean`}`);
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
    s.off.length ? `off: ${s.off.join(', ')}` : '',
  ].filter(Boolean);
  out.push(c.dim(`  ${notes.join(' · ')}`));
  return out;
}

/** `lint` alone: one numbered failure per file, its first finding and the others under it, then the warnings. */
function lintFailures(report: CheckReport, options: ReportOptions, c: Painter, out: string[]): string[] {
  const lint = report.lint!;
  // A message of several lines, such as a command's output, goes on under the finding, indented.
  const line = (p: Problem) => `${where(lint.skill, p, options)}  ${p.unit ?? '-'}  ${brief(withOrigin(lint.skill, p, options)).split('\n').join('\n        ')}`;
  const failures = byFile(lint.problems.filter((p) => p.severity === 'error'), line).map((lines) => [lines[0]!, ...lines.slice(1).map((l) => `   ${l}`)]);
  const warnings = byFile(lint.problems.filter((p) => p.severity === 'warning'), line).flat();
  if (failures.length) {
    out.push('', c.bold(c.red('Failures')));
    failures.forEach((block, i) => out.push('', `  ${i + 1}) ${block[0]}`, ...block.slice(1).map((l) => `  ${l}`)));
  }
  if (warnings.length) out.push('', c.bold(c.yellow('Warnings')), ...warnings.map((l) => `  ${l}`));
  return [];
}

/** Lint findings as one block per file, compacted, with the findings left out counted. */
function byFile(problems: Problem[], line: (p: Problem) => string): string[][] {
  const files = new Map<string, Problem[]>();
  for (const p of problems) files.set(p.file, [...(files.get(p.file) ?? []), p]);
  return [...files.values()].map((list) => compact(list).flatMap(({ problem, more }) => [line(problem), ...(more ? [`  +${more} more in this example`] : [])]));
}

// ---------------------------------------------------------------- by unit

/** The tree, its summary, and what has no place in it. Returns the index of what failed. */
function byUnit(report: CheckReport, options: ReportOptions, c: Painter, out: string[]): string[] {
  const tree = unitTree(report);
  const { proof, test } = report;
  const at = (file: string) => skillFile(tree.skill, file, options);

  // ---------------------------------------------------------------- the header
  const header: string[] = [];
  if (proof && !proof.configured) header.push('proof not configured');
  else if (proof) header.push(`proof ${runLine(proof.run)}`);
  if (test) {
    const model = test.specs.find((s) => s.model)?.model;
    const asked = [test.provider, model].filter(Boolean).join(' · ');
    const label = test.specs.length === 0 ? 'nothing to run' : test.dryRun ? 'dry run: nothing sent' : asked;
    const since = test.changed ? ` · changed since ${test.changed.ref} (${test.changed.commit.slice(0, 7)})` : '';
    header.push(`test ${label}${since}`);
  }
  out.push('', `${c.bold('Units')}  ${c.dim(header.join(' · '))}`);

  // In a dry run, the size of each request, which nothing else shows.
  if (test?.dryRun && test.specs.length) {
    const names = test.specs.map((s) => shown(s.spec, options));
    const w = Math.max(24, ...names.map((n) => n.length)) + 2;
    out.push(c.dim(`    ${pad('SPEC', w)}${padStart('TESTS', 7)}${padStart('TOKENS', 9)}`));
    test.specs.forEach((spec, i) => {
      const tokens = spec.estimatedTokens ? `~${spec.estimatedTokens.toLocaleString('en-US')}` : '-';
      out.push(`  ${sign(c, spec.error ? 'fail' : 'pass')} ${pad(names[i]!, w)}${padStart(String(spec.verdicts.length), 7)}${padStart(tokens, 9)}`);
    });
  }

  // ---------------------------------------------------------------- the tree
  const failed: string[] = [];
  const show = (line: Line, indent: number, path: string[]) => {
    const d = describe(line, report, options, c);
    out.push(`${' '.repeat(indent)}${pad(layerOf(line), 7)}${sign(c, line.mark)}${d.text ? ` ${d.text}` : ''}`);
    for (const detail of d.details.flatMap((x) => x.split('\n'))) out.push(`${' '.repeat(indent + 9)}${detail}`);
    if (line.mark === 'fail') failed.push([...path, d.short].join(' › '));
  };
  const idOf = (u: UnitNode) => (u.mark === 'fail' ? c.red(u.id) : u.mark === 'warn' ? c.yellow(u.id) : c.green(u.id));

  if (options.compact) compactTree(tree, report, c, out, at, show, idOf);
  else {
    for (const file of tree.files) {
      const path = at(file.file);
      out.push('', `  ${c.bold(path)}`);
      for (const line of file.lines) show(line, 4, [path]);
      for (const u of file.units) {
        out.push(u.coverage === 'none' ? `    ${c.yellow(`${u.id}  ${u.kind}  not covered`)}` : `    ${idOf(u)}  ${c.dim(u.kind)}`);
        for (const line of u.lines) show(line, 6, [path, u.id]);
      }
    }
  }
  if (tree.otherFiles) out.push('', c.dim(`  ${plural(tree.otherFiles, 'other file')}, no unit`));

  // ---------------------------------------------------------------- the summary
  const notes: string[] = [];
  if (tree.coverage) {
    const n = tree.coverage;
    const units = n.both + n.proof + n.test + n.none;
    notes.push(`${plural(units, 'unit')} · ${n.both} proof and test · ${n.proof} proof only · ${n.test} test only · ${n.none} not covered`);
  }
  if (proof?.configured) notes.push(proofSummary(proof));
  if (test) {
    const s = test.summary;
    notes.push(
      [
        plural(s.tests, 'test'),
        s.skipped ? `${plural(s.skipped, 'spec')} left out by --changed` : '',
        s.borderline ? `${s.borderline} borderline: within ${test.thresholds.margin} of the threshold` : '',
        test.dryRun || s.tests === 0 ? '' : `${s.usage.input_tokens.toLocaleString('en-US')} in / ${s.usage.output_tokens.toLocaleString('en-US')} out tokens`,
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }
  out.push('', ...notes.map((n) => c.dim(`  ${n}`)));
  const change = proof?.configured ? buildChange(proof, options) : null;
  if (change) out.push(`  ${change}`);

  if (tree.elsewhere.length) {
    out.push('', c.bold('Elsewhere'));
    for (const line of tree.elsewhere) show(line, 2, []);
  }
  return failed;
}

/** What ran the tests, for the header: the command, how long it took and its exit code, or why nothing ran. */
function runLine(run: RunReport): string {
  if ('skipped' in run) return run.skipped === 'no-run' ? '--no-run: the units already left' : 'proof.run not set: the units already left';
  return `ran \`${run.command}\` in ${(run.ms / 1000).toFixed(1)} s, exit ${run.status ?? 'none'}`;
}

/** One row per unit: its id, kind, proof state and tests passed of total, with what failed under it. */
function compactTree(
  tree: UnitTree,
  report: CheckReport,
  c: Painter,
  out: string[],
  at: (file: string) => string,
  show: (line: Line, indent: number, path: string[]) => void,
  idOf: (u: UnitNode) => string,
) {
  const w = Math.max(1, ...tree.files.flatMap((f) => f.units.map((u) => u.id.length))) + 2;
  const dry = report.test?.dryRun;
  const testsOf = (t: { passed: number; total: number } | undefined) => (!t ? '–' : dry ? `${t.total} ready` : `${t.passed}/${t.total}`);
  const row = (mark: Mark, id: string, kind: string, proofState: string, tests: string) =>
    `    ${sign(c, mark)} ${pad(id, w)}${pad(c.dim(kind), 10)}${tree.layers.proof ? pad(proofState, 10) : ''}${tree.layers.test ? tests : ''}`.trimEnd();
  const worst = (lines: Line[]): Mark => (lines.some((l) => l.mark === 'fail') ? 'fail' : lines.some((l) => l.mark === 'warn') ? 'warn' : 'pass');

  for (const file of tree.files) {
    const path = at(file.file);
    out.push('', `  ${c.bold(path)}`);
    if (file.lines.length) {
      const verdicts = file.lines.filter((l) => l.kind === 'verdict');
      const tests = verdicts.length ? { passed: verdicts.filter((l) => l.verdict.pass).length, total: verdicts.length } : undefined;
      out.push(row(worst(file.lines), '-', '', '', testsOf(tests)));
      for (const line of file.lines) if (line.mark === 'fail') show(line, 8, [path]);
    }
    for (const u of file.units) {
      const p = u.proof;
      const state = !p ? '–' : p.state === 'passed' ? 'test' : p.state === 'hand' ? 'hand' : p.state;
      out.push(row(u.mark, idOf(u), u.kind, state, testsOf(u.tests)));
      for (const line of u.lines) if (line.mark === 'fail') show(line, 8, [path, u.id]);
    }
  }
}

/** A line's text after its mark, the details under it, and how the index of failures names it. */
function describe(line: Line, report: CheckReport, options: ReportOptions, c: Painter): { text: string; details: string[]; short: string } {
  const skill = report.lint?.skill ?? (report.proof?.configured ? report.proof.skill : undefined) ?? report.test?.skill ?? '';
  switch (line.kind) {
    case 'lint':
    case 'proof': {
      const place = where(skill, line.problem, options);
      const [first, ...rest] = brief(withOrigin(skill, line.problem, options)).split('\n');
      const more = line.kind === 'lint' && line.more ? [c.dim(`+${line.more} more in this example`)] : [];
      return { text: `${place}  ${first}`, details: [...rest, ...more], short: `${line.kind} ${place}` };
    }
    case 'origin': {
      const u = line.unit;
      const text = u.test ? `from a test ${skillFile(skill, u.test.file, options)}:${u.test.line}` : 'by hand';
      return { text, details: [], short: text };
    }
    case 'verdict': {
      const v = line.verdict;
      const place = `${shown(line.spec.spec, options)}:${v.line ?? 1}  ${v.id}`;
      const note = line.unknownUnit ? [c.yellow(`unit: ${v.unit} names no unit of the skill`)] : [];
      const details = !v.pass ? testFailure(v, report) : v.borderline ? [`${decidingNumber(v, report)} · borderline: the next run may fail it`] : [];
      return { text: `${place}  ${answer(v, report)}`, details: [...note, ...details], short: place };
    }
    case 'spec': {
      const place = `${shown(line.spec.spec, options)}  could not run`;
      return { text: place, details: [line.spec.error ?? ''], short: place };
    }
    case 'missing':
      return { text: '', details: [], short: '' };
  }
}

/** The answer and the number that decided it: `stop 0.92`, or `yes P(yes) 0.76` for a yes/no test. */
function answer(v: Verdict, report: CheckReport): string {
  if (report.test?.dryRun) return 'ready';
  if (v.refused) return 'refused';
  return `${v.answer} ${v.probabilities ? '' : 'P(yes) '}${v.confidence.toFixed(2)}`;
}

function testFailure(v: SpecReport['verdicts'][number], report: CheckReport): string[] {
  const verdict = `${v.weak ? 'right answer, under the threshold' : 'wrong answer'}${v.borderline ? ', borderline: the next run may pass it' : ''}`;
  return [
    `scenario:  ${v.scenario}`,
    `question:  ${v.question}`,
    `expected:  ${v.expect}`,
    ...(v.refused ? [`got:       nothing: the model refused to answer`] : [`got:       ${v.answer} · ${decidingNumber(v, report)} · ${verdict}`, `           ${distribution(v)}`]),
    ...(v.variants ? [`phrasings: ${v.variants.map((p) => p.toFixed(2)).join('  ')} (probability of "${v.expect}" for each; the median decides)`] : []),
  ];
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
