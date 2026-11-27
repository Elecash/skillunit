/**
 * The default reporter, for people: the report by unit (`units.ts`), each file of the skill, each
 * unit in it, and under the unit the lines of each layer, each failure with its details under it.
 * Then an index of what failed, so the end of the output, which is what a terminal shows, names
 * it. The JSON report keeps every finding whole.
 */
import { join } from 'node:path';
import type { RunReport } from '../proof/layer.js';
import type { Verdict } from '../test/reader.js';
import type { RequestReport } from '../test/runner.js';
import { answered, brief, buildChange, decidingNumber, proofSummary, distribution, painter, pad, padStart, plural, shown, skillFile, statusLine, where, withOrigin } from './text.js';
import type { CheckReport, ReportOptions } from './types.js';
import { layerOf, unitTree, type Line, type Mark, type UnitNode, type UnitTree } from './units.js';

type Painter = ReturnType<typeof painter>;

export function table(report: CheckReport, options: ReportOptions): string {
  const c = painter(options.color);
  const out: string[] = [];
  const failed = byUnit(report, options, c, out);
  if (failed.length) out.push('', c.bold(c.red('Failed')), ...failed.map((f) => `  ${f}`));

  out.push('', report.ok ? c.green(statusLine(report)) : c.red(statusLine(report)), '');
  return out.join('\n');
}

const sign = (c: Painter, mark: Mark) =>
  mark === 'pass' ? c.green('✓') : mark === 'fail' ? c.red('✗') : mark === 'warn' ? c.yellow('~') : mark === 'none' ? c.dim('–') : c.dim('·');

// ---------------------------------------------------------------- by unit

/** The tree, its summary, and what has no place in it. Returns the index of what failed. */
function byUnit(report: CheckReport, options: ReportOptions, c: Painter, out: string[]): string[] {
  const tree = unitTree(report);
  const { proof, test } = report;
  const at = (file: string) => skillFile(tree.skill, file, options);

  // ---------------------------------------------------------------- the header
  const header: string[] = [];
  if (proof) header.push(`proof ${runLine(proof.run)}`);
  if (test) {
    const model = test.requests.find((s) => s.model)?.model;
    const asked = [test.provider, model].filter(Boolean).join(' · ');
    const label = test.requests.length === 0 ? 'nothing to ask' : test.dryRun ? 'dry run: nothing sent' : asked;
    const since = test.changed ? ` · changed since ${test.changed.ref} (${test.changed.commit.slice(0, 7)})` : '';
    header.push(`test ${test.run ? `${runLine(test.run)} · ` : ''}${label}${since}`);
  }
  out.push('', `${c.bold('Units')}  ${c.dim(header.join(' · '))}`);

  // In a dry run, the size of each request, which nothing else shows.
  if (test?.dryRun && test.requests.length) {
    const names = test.requests.map((r) => requestName(r, options, tree.skill));
    const w = Math.max(24, ...names.map((n) => n.length)) + 2;
    out.push(c.dim(`    ${pad('FILE', w)}${padStart('TESTS', 7)}${padStart('TOKENS', 9)}`));
    test.requests.forEach((r, i) => {
      const tokens = r.estimatedTokens ? `~${r.estimatedTokens.toLocaleString('en-US')}` : '-';
      out.push(`  ${sign(c, r.error ? 'fail' : 'pass')} ${pad(names[i]!, w)}${padStart(String(r.verdicts.length || (r.questions?.length ?? 0)), 7)}${padStart(tokens, 9)}`);
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
  // A run that failed first: what the tree says about a unit with no record may follow from it.
  if (tree.run.length) {
    out.push('', c.bold(c.red('proof.run failed')));
    for (const line of tree.run) show(line, 2, []);
  }
  const idOf = (u: UnitNode) => (u.mark === 'fail' ? c.red(u.id) : u.mark === 'warn' ? c.yellow(u.id) : c.green(u.id));

  // A run that failed before any test wrote a record, as a type-check does: every unit of the tree
  // would have nothing under it, so the run is all there is to show.
  if (tree.run.length && (proof ? proof.summary.files === 0 : test?.summary.tests === 0)) {
    const what = proof && test ? 'built, compared or asked' : proof ? 'built or compared' : 'asked';
    out.push('', c.dim(`  nothing ${what}: the run left no record`));
    return failed;
  }

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

  // ---------------------------------------------------------------- the summary
  const notes: string[] = [];
  // Two counts of units: those of the skill folder, which the questions read, and those the tests
  // declare, which the build gives. When they differ, each says which it counts.
  const inFolder = tree.coverage ? Object.values(tree.coverage).reduce((a, b) => a + b, 0) : undefined;
  const differ = inFolder !== undefined && proof !== undefined && inFolder !== proof.summary.units;
  if (tree.coverage) {
    const n = tree.coverage;
    notes.push(`${plural(inFolder!, 'unit')}${differ ? ' in the skill folder' : ''} · ${n.both} proof and test · ${n.proof} proof only · ${n.test} test only · ${n.none} not covered`);
  }
  if (proof) notes.push(proofSummary(proof, differ ? ' the tests declare' : ''));
  if (test) {
    const s = test.summary;
    notes.push(
      [
        plural(s.tests, 'test'),
        s.skipped ? `${plural(s.skipped, 'question')} left out by --changed` : '',
        s.borderline ? `${s.borderline} borderline: within ${test.thresholds.margin} of the threshold` : '',
        test.dryRun || s.tests === 0 ? '' : `${s.usage.input_tokens.toLocaleString('en-US')} in / ${s.usage.output_tokens.toLocaleString('en-US')} out tokens`,
      ]
        .filter(Boolean)
        .join(' · '),
    );
  }
  out.push('', ...notes.map((n) => c.dim(`  ${n}`)));
  const change = proof ? buildChange(proof, options) : null;
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
      const state = !p ? '–' : p.state === 'passed' ? (p.from === 'test' ? 'test' : 'declared') : p.state;
      out.push(row(u.mark, idOf(u), u.kind, state, testsOf(u.tests)));
      for (const line of u.lines) if (line.mark === 'fail') show(line, 8, [path, u.id]);
    }
  }
}

/** A line's text after its mark, the details under it, and how the index of failures names it. */
function describe(line: Line, report: CheckReport, options: ReportOptions, c: Painter): { text: string; details: string[]; short: string } {
  const skill = (report.proof?.skill) ?? report.test?.skill ?? '';
  switch (line.kind) {
    case 'proof': {
      const place = where(skill, line.problem, options);
      const [first, ...rest] = brief(withOrigin(skill, line.problem, options)).split('\n');
      return { text: `${place}  ${first}`, details: rest, short: `proof ${place}` };
    }
    case 'origin': {
      const u = line.unit;
      const place = u.test ? `, ${skillFile(skill, u.test.file, options)}:${u.test.line}` : '';
      const text = u.from === 'test' ? `proved by a test${place}` : `declared, no test${place}`;
      return { text, details: [], short: text };
    }
    case 'verdict': {
      const v = line.verdict;
      const place = `${v.declared ? `${shown(v.declared.file, options)}:${v.declared.line}` : skillFile(skill, line.request.file, options)}  ${v.id}`;
      const details = !v.pass ? testFailure(v, report) : v.borderline ? [`${decidingNumber(v, report)} · borderline: the next run may fail it`] : [];
      return { text: `${place}  ${answer(v, report)}`, details, short: place };
    }
    case 'request': {
      const place = `${requestName(line.request, options, skill)}  could not run`;
      const asked = (line.request.questions ?? []).map((q) => `${q.id} (${shown(q.declared.file, options)}:${q.declared.line})`);
      return { text: place, details: [line.request.error ?? '', ...(asked.length ? [`questions: ${asked.join(', ')}`] : [])], short: place };
    }
    case 'question': {
      const p = line.problem;
      const place = p.declared ? `${shown(p.declared.file, options)}:${p.declared.line}${p.id ? `  ${p.id}` : ''}` : '';
      const [first, ...rest] = brief(p.message).split('\n');
      return { text: place ? `${place}  ${first}` : first!, details: rest, short: place || 'proof.run' };
    }
    case 'missing':
      return { text: '', details: [], short: '' };
  }
}

/** The answer and the number that decided it: `stop 0.92`, or `yes P(yes) 0.76` for a yes/no test. */
function answer(v: Verdict, report: CheckReport): string {
  if (report.test?.dryRun) return 'ready';
  if (v.refused) return 'refused';
  return `${answered(v)} ${v.probabilities ? '' : 'P(yes) '}${v.confidence.toFixed(2)}`;
}

/** A request as the report names it: its file, and its sections and `with` files when it has them. */
function requestName(r: RequestReport, options: ReportOptions, skill: string): string {
  const parts = [skillFile(skill, r.file, options), ...(r.sections.length ? [`§ ${r.sections.join(', ')}`] : []), ...(r.with.length ? [`with ${r.with.join(', ')}`] : [])];
  return parts.join(' ');
}

function testFailure(v: Verdict, report: CheckReport): string[] {
  const verdict = `${v.tied ? 'a tie, which does not pass' : v.weak ? 'right answer, under the threshold' : 'wrong answer'}${v.borderline ? ', borderline: the next run may pass it' : ''}`;
  const passes = v.variantsPass ?? [];
  const phrasings = v.variants?.map((p, i) => `${p.toFixed(2)}${passes[i] === undefined ? '' : passes[i] ? ' pass' : ' fail'}`);
  const passed = v.variantsPass ? `; ${passes.filter(Boolean).length} of ${passes.length} pass, and most must` : '';
  return [
    `scenario:  ${v.scenario}`,
    `question:  ${v.question}`,
    `expected:  ${v.expect}`,
    ...(v.refused ? [`got:       nothing: the model refused to answer`] : [`got:       ${answered(v)} · ${decidingNumber(v, report)} · ${verdict}`, `           ${distribution(v)}`]),
    ...(phrasings ? [`phrasings: ${phrasings.join('  ')} (probability of "${v.expect}" for each${passed})`] : []),
  ];
}
