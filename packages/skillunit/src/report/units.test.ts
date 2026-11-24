import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../config.js';
import type { LintResult, Problem } from '../lint/types.js';
import type { ProofResult, UnitProof } from '../proof/layer.js';
import type { Verdict } from '../test/reader.js';
import type { Report, SpecReport } from '../test/runner.js';
import { buildReport, type CheckReport, type Command, type ReportUnit } from './types.js';
import { unitTree, type Line, type UnitTree } from './units.js';

const skill = '/repo/skill';

/** Four units in two files: one with proof and tests, one with proof only, one with tests only, one with neither. */
const units: ReportUnit[] = [
  { id: 'await-every-request', kind: 'rule', file: 'SKILL.md', line: 10 },
  { id: 'retry-defaults', kind: 'fact', file: 'features/retries.md', line: 5 },
  { id: 'what-is-retried', kind: 'fact', file: 'features/retries.md', line: 15 },
  { id: 'retry-idempotent-only', kind: 'rule', file: 'features/retries.md', line: 25 },
  { id: 'never-disable-timeout', kind: 'rule', file: 'features/timeouts.md', line: 8 },
];

const lint = (problems: Problem[] = []): LintResult => ({
  skill,
  files: ['SKILL.md', 'features/clients.md', 'features/retries.md', 'features/timeouts.md'],
  ok: !problems.some((p) => p.severity === 'error'),
  problems,
  summary: { files: 4, units: units.length, typeChecked: 0, notParsed: 0, commandChecked: 0, unchecked: {}, noCheck: 0, notConfigured: 0, off: [], undeclared: [] },
});

const unitProof = (id: string, status?: 'passed' | 'failed' | 'skipped'): UnitProof => {
  const u = units.find((x) => x.id === id)!;
  const tests = status ? [{ report: '../reports/junit.xml', line: 3, title: `src/a.test.ts › ${id} [skill:${id}]`, status }] : [];
  return { id, file: u.file, line: u.line, state: status === 'passed' ? 'proved' : status === 'failed' ? 'failed' : 'unproved', listed: status === 'passed', tests, fences: [] };
};

const proof = (overrides: Partial<ProofResult> = {}): ProofResult => ({
  configured: true,
  ok: true,
  skill,
  reports: ['../reports/junit.xml'],
  write: false,
  lock: { file: '../skillunit.lock', exists: true, listed: 2, added: [], dropped: [], forgot: [], written: false },
  units: [unitProof('await-every-request', 'passed'), unitProof('retry-defaults', 'passed'), unitProof('what-is-retried', 'passed'), unitProof('retry-idempotent-only'), unitProof('never-disable-timeout')],
  problems: [],
  summary: { units: 5, proved: 3, failed: 0, unproved: 2, tagged: 3, fences: 0, differ: 0, written: 0 },
  ...overrides,
});

const verdict = (id: string, line: number, unit?: string, extra: Partial<Verdict> = {}): Verdict => ({
  id,
  expect: 'a',
  answer: 'a',
  confidence: 0.9,
  expectedProb: 0.9,
  probabilities: { a: 0.9, none: 0.1 },
  pass: true,
  weak: false,
  borderline: false,
  scenario: 's',
  question: 'q',
  line,
  ...(unit ? { unit } : {}),
  ...extra,
});

const spec = (name: string, file: string, verdicts: Verdict[], extra: Partial<SpecReport> = {}): SpecReport => ({
  spec: `/repo/specs/${name}.yaml`,
  file,
  sections: [],
  with: [],
  chars: 100,
  estimatedTokens: 100,
  verdicts,
  usage: { input_tokens: 0, output_tokens: 0 },
  ...extra,
});

const test = (specs: SpecReport[], overrides: Partial<Report> = {}): Report => {
  const all = specs.flatMap((s) => s.verdicts);
  return {
    ok: specs.every((s) => !s.error && s.verdicts.every((v) => v.pass)),
    skill,
    dryRun: false,
    thresholds: { ...DEFAULT_THRESHOLDS },
    specs,
    summary: { tests: all.length, passed: all.filter((v) => v.pass).length, borderline: 0, skipped: 0, usage: { input_tokens: 0, output_tokens: 0 } },
    ...overrides,
  };
};

const specs = () => [
  spec('skill', 'SKILL.md', [verdict('await-the-call', 4, 'await-every-request'), verdict('which-file', 13)]),
  spec('retries', 'features/retries.md', [verdict('retry-delay-default', 4, 'retry-defaults'), verdict('post-no-retry', 10, 'retry-idempotent-only')]),
];

const report = (command: Command, layers: Omit<CheckReport, 'schema' | 'command' | 'ok'>) => buildReport(command, { units, ...layers });

const unit = (tree: UnitTree, id: string) => tree.files.flatMap((f) => f.units).find((u) => u.id === id)!;
const file = (tree: UnitTree, name: string) => tree.files.find((f) => f.file === name);
/** A line as `layer mark what`, short enough to compare. */
const brief = (l: Line): string => {
  switch (l.kind) {
    case 'lint':
    case 'proof':
      return `${l.kind} ${l.mark} ${l.problem.file}:${l.problem.line}${l.kind === 'lint' && l.more ? ` +${l.more}` : ''}`;
    case 'tagged':
      return `tagged ${l.mark} ${l.test.title}${l.problem ? ' (with its finding)' : ''}`;
    case 'verdict':
      return `test ${l.mark} ${l.verdict.id}${l.unknownUnit ? ' (unknown unit)' : ''}`;
    case 'spec':
      return `spec ${l.mark} ${l.spec.spec}`;
    case 'missing':
      return `${l.layer} none`;
  }
};
const lines = (ls: Line[]) => ls.map(brief);

describe('the report by unit', () => {
  const whole = unitTree(report('check', { lint: lint(), proof: proof(), test: test(specs()) }));

  it('puts proof and tests under their unit, proof first', () => {
    expect(lines(unit(whole, 'await-every-request').lines)).toEqual(['tagged pass src/a.test.ts › await-every-request [skill:await-every-request]', 'test pass await-the-call']);
    expect(unit(whole, 'await-every-request').coverage).toBe('both');
  });

  it('marks a unit with proof only, tests only, or neither', () => {
    expect(lines(unit(whole, 'what-is-retried').lines)).toEqual(['tagged pass src/a.test.ts › what-is-retried [skill:what-is-retried]', 'test none']);
    expect(unit(whole, 'what-is-retried').coverage).toBe('proof');
    expect(lines(unit(whole, 'retry-idempotent-only').lines)).toEqual(['proof none', 'test pass post-no-retry']);
    expect(unit(whole, 'retry-idempotent-only').coverage).toBe('test');
    const neither = unit(whole, 'never-disable-timeout');
    expect(lines(neither.lines)).toEqual(['proof none', 'test none']);
    expect(neither).toMatchObject({ coverage: 'none', mark: 'warn' });
    expect(whole.coverage).toEqual({ both: 2, proof: 1, test: 1, none: 1 });
  });

  it('counts coverage only when check ran both layers over the whole skill', () => {
    expect(unitTree(report('test', { test: test(specs()) })).coverage).toBeNull();
    expect(unitTree(report('proof', { proof: proof() })).coverage).toBeNull();
    expect(unitTree(report('check', { lint: lint(), proof: { configured: false, ok: true }, test: test(specs()) })).coverage).toBeNull();
    expect(unitTree(report('check', { lint: lint(), proof: proof(), test: test(specs(), { changed: { ref: 'main', commit: 'abc' } }) })).coverage).toBeNull();
    const tree = unitTree(report('test', { test: test(specs()) }));
    expect(unit(tree, 'never-disable-timeout')).toMatchObject({ coverage: null, mark: 'pass' });
  });

  it('hangs a test with no `unit:` under its spec file, before the units', () => {
    expect(lines(file(whole, 'SKILL.md')!.lines)).toEqual(['test pass which-file']);
  });

  it('hangs a test whose `unit:` names no unit under its spec file, with a note', () => {
    const tree = unitTree(report('test', { test: test([spec('retries', 'features/retries.md', [verdict('gone', 3, 'no-such-unit')])]) }));
    expect(lines(file(tree, 'features/retries.md')!.lines)).toEqual(['test pass gone (unknown unit)']);
  });

  it('hangs a test whose `unit:` is in another file under that unit', () => {
    const tree = unitTree(report('test', { test: test([spec('skill', 'SKILL.md', [verdict('cross', 3, 'retry-defaults')])]) }));
    expect(file(tree, 'SKILL.md')!.lines).toEqual([]);
    expect(lines(unit(tree, 'retry-defaults').lines)).toEqual(['test pass cross']);
  });

  it('puts a lint finding under its unit, under its file without one, and a file with no unit gets a node', () => {
    const problems: Problem[] = [
      { file: 'features/retries.md', line: 27, unit: 'retry-idempotent-only', severity: 'error', rule: 'check', message: 'breaks it' },
      { file: 'features/retries.md', line: 1, severity: 'warning', rule: 'index', message: 'long' },
      { file: 'features/clients.md', line: 3, severity: 'error', rule: 'index', message: 'link does not resolve' },
    ];
    const tree = unitTree(report('check', { lint: lint(problems), proof: proof(), test: test(specs()) }));
    expect(lines(unit(tree, 'retry-idempotent-only').lines)).toEqual(['lint fail features/retries.md:27', 'proof none', 'test pass post-no-retry']);
    expect(unit(tree, 'retry-idempotent-only').mark).toBe('fail');
    expect(lines(file(tree, 'features/retries.md')!.lines)).toEqual(['lint warn features/retries.md:1']);
    expect(file(tree, 'features/clients.md')).toMatchObject({ units: [], lines: [expect.objectContaining({ kind: 'lint', mark: 'fail' })] });
    expect(tree.files.map((f) => f.file)).toEqual(['SKILL.md', 'features/clients.md', 'features/retries.md', 'features/timeouts.md']);
    expect(tree.otherFiles).toBe(0);
  });

  it('counts the files with no unit, test or finding', () => {
    expect(whole.files.map((f) => f.file)).toEqual(['SKILL.md', 'features/retries.md', 'features/timeouts.md']);
    expect(whole.otherFiles).toBe(1);
  });

  it('keeps at most three findings of an example, and each line and message once', () => {
    const type = (line: number): Problem => ({ file: 'features/retries.md', line, unit: 'retry-defaults', severity: 'error', rule: 'types', message: `TS2304 at ${line}`, code: 'TS2304', example: 6 });
    const tree = unitTree(report('lint', { lint: lint([type(7), type(7), type(8), type(9), type(10), type(11)]) }));
    expect(lines(unit(tree, 'retry-defaults').lines)).toEqual(['lint fail features/retries.md:7', 'lint fail features/retries.md:8', 'lint fail features/retries.md:9 +2']);
  });

  it('sends a finding about the lock, the settings or a report, and a spec that could not run, elsewhere', () => {
    const problems: Problem[] = [
      { file: '../skillunit.lock', line: 2, severity: 'error', rule: 'proof', message: 'lists `gone`' },
      { file: 'skillunit.yaml', line: 1, severity: 'error', rule: 'proof', message: 'no report' },
    ];
    const broken = spec('broken', 'SKILL.md', [], { error: 'no heading "Gone" in SKILL.md' });
    const tree = unitTree(report('check', { lint: lint(), proof: proof({ ok: false, problems }), test: test([...specs(), broken]) }));
    expect(lines(tree.elsewhere)).toEqual(['proof fail ../skillunit.lock:2', 'proof fail skillunit.yaml:1', 'spec fail /repo/specs/broken.yaml']);
  });

  it('shows a failed tagged test with the finding its failure gave, and other proof findings of the unit after it', () => {
    const failed = { ...unitProof('retry-defaults', 'failed') };
    const title = failed.tests[0]!.title;
    const problems: Problem[] = [
      { file: 'features/retries.md', line: 5, unit: 'retry-defaults', severity: 'error', rule: 'proof', message: `the test "${title}" (reports/junit.xml:3) failed: expected 300` },
      { file: 'features/retries.md', line: 9, unit: 'retry-defaults', severity: 'error', rule: 'proof', message: 'this block is not what the test gives' },
    ];
    const tree = unitTree(report('proof', { proof: proof({ ok: false, units: [failed], problems }) }));
    expect(lines(unit(tree, 'retry-defaults').lines)).toEqual([`tagged fail ${title} (with its finding)`, 'proof fail features/retries.md:9']);
  });

  it('marks a skipped tagged test as a warning, and its unit', () => {
    const tree = unitTree(report('proof', { proof: proof({ units: [unitProof('retry-defaults', 'skipped')] }) }));
    expect(lines(unit(tree, 'retry-defaults').lines)).toEqual(['tagged warn src/a.test.ts › retry-defaults [skill:retry-defaults]']);
    expect(unit(tree, 'retry-defaults').mark).toBe('warn');
  });

  it('marks the tests of a dry run as ready', () => {
    const tree = unitTree(report('test', { test: test(specs(), { dryRun: true }) }));
    expect(lines(unit(tree, 'retry-defaults').lines)).toEqual(['test ready retry-delay-default']);
    expect(unit(tree, 'retry-defaults').mark).toBe('pass');
  });

  it('with --changed or spec paths, keeps only the units and files that have a line', () => {
    const retries = [spec('retries', 'features/retries.md', [verdict('post-no-retry', 10, 'retry-idempotent-only')])];
    for (const t of [test(retries, { changed: { ref: 'main', commit: 'abc' } }), test(retries, { paths: ['specs/retries.yaml'] })]) {
      const tree = unitTree(report('test', { test: t }));
      expect(tree.partial).toBe(true);
      expect(tree.files.map((f) => [f.file, f.units.map((u) => u.id)])).toEqual([['features/retries.md', ['retry-idempotent-only']]]);
      expect(lines(unit(tree, 'retry-idempotent-only').lines)).toEqual(['test pass post-no-retry']);
      expect(tree.otherFiles).toBeNull();
    }
    // check --changed: proof ran over the whole skill, so every unit with a proof line stays.
    const check = unitTree(report('check', { lint: lint(), proof: proof(), test: test(retries, { changed: { ref: 'main', commit: 'abc' } }) }));
    expect(check.files.flatMap((f) => f.units.map((u) => u.id))).toEqual(['await-every-request', 'retry-defaults', 'what-is-retried', 'retry-idempotent-only']);
    expect(lines(unit(check, 'retry-defaults').lines)).toEqual(['tagged pass src/a.test.ts › retry-defaults [skill:retry-defaults]']);
  });

  it('with no `proof` key, has no proof lines', () => {
    const tree = unitTree(report('check', { lint: lint(), proof: { configured: false, ok: true }, test: test(specs()) }));
    expect(tree.layers).toEqual({ lint: true, proof: false, test: true });
    expect(tree.files.flatMap((f) => f.units).flatMap((u) => u.lines).some((l) => l.kind === 'tagged' || l.kind === 'missing' && l.layer === 'proof')).toBe(false);
  });
});
