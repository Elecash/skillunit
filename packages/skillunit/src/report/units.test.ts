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

const unitProof = (id: string, state: UnitProof['state'] = 'hand'): UnitProof => {
  const u = units.find((x) => x.id === id)!;
  return {
    id,
    kind: state === 'passed' || state === 'hand' ? u.kind : null,
    from: state === 'hand' ? 'hand' : 'test',
    state,
    file: u.file,
    line: u.line,
    source: { file: `../skill-src/${u.file}`, line: u.line },
    ...(state === 'hand' || state === 'missing' ? {} : { test: { file: '../src/a.test.ts', line: 3 } }),
  };
};

const proof = (overrides: Partial<ProofResult> = {}): ProofResult => ({
  configured: true,
  ok: true,
  skill,
  source: '/repo/skill-src',
  write: false,
  run: { command: 'npx vitest run', status: 0, ms: 1000 },
  units: [unitProof('await-every-request', 'passed'), unitProof('retry-defaults', 'passed'), unitProof('what-is-retried', 'passed'), unitProof('retry-idempotent-only'), unitProof('never-disable-timeout')],
  files: [],
  problems: [],
  summary: { units: 5, fromTests: 3, byHand: 2, failed: 0, missing: 0, values: 0, files: 4, differ: 0, written: 0, extra: 0 },
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
    case 'origin':
      return `origin ${l.mark} ${l.unit.from}`;
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
    expect(lines(unit(whole, 'await-every-request').lines)).toEqual(['origin pass test', 'test pass await-the-call']);
    expect(unit(whole, 'await-every-request').coverage).toBe('both');
  });

  it('marks a unit with proof only, tests only, or neither', () => {
    expect(lines(unit(whole, 'what-is-retried').lines)).toEqual(['origin pass test', 'test none']);
    expect(unit(whole, 'what-is-retried').coverage).toBe('proof');
    expect(lines(unit(whole, 'retry-idempotent-only').lines)).toEqual(['origin none hand', 'test pass post-no-retry']);
    expect(unit(whole, 'retry-idempotent-only').coverage).toBe('test');
    const neither = unit(whole, 'never-disable-timeout');
    expect(lines(neither.lines)).toEqual(['origin none hand', 'test none']);
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
    expect(lines(unit(tree, 'retry-idempotent-only').lines)).toEqual(['lint fail features/retries.md:27', 'origin none hand', 'test pass post-no-retry']);
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

  it('sends a finding about the settings or a record, and a spec that could not run, elsewhere', () => {
    const problems: Problem[] = [
      { file: '../tmp/skill-units/a.json', line: 1, severity: 'error', rule: 'proof', message: 'not valid JSON' },
      { file: 'skillunit.yaml', line: 1, severity: 'error', rule: 'proof', message: 'proof.run left no unit' },
    ];
    const broken = spec('broken', 'SKILL.md', [], { error: 'no heading "Gone" in SKILL.md' });
    const tree = unitTree(report('check', { lint: lint(), proof: proof({ ok: false, problems }), test: test([...specs(), broken]) }));
    expect(lines(tree.elsewhere)).toEqual(['proof fail ../tmp/skill-units/a.json:1', 'proof fail skillunit.yaml:1', 'spec fail /repo/specs/broken.yaml']);
  });

  it('puts a finding about a unit under it, even when it is in the source or a test file', () => {
    const problems: Problem[] = [
      { file: '../skill-src/features/retries.md', line: 5, unit: 'retry-defaults', severity: 'error', rule: 'proof', message: 'the test of `retry-defaults` failed: expected 300' },
      { file: '../src/a.test.ts', line: 9, unit: 'what-is-retried', severity: 'error', rule: 'proof', message: 'no file of `source` has its slot' },
    ];
    const tree = unitTree(report('proof', { proof: proof({ ok: false, units: [unitProof('retry-defaults', 'failed'), unitProof('what-is-retried', 'passed')], problems }) }));
    expect(lines(unit(tree, 'retry-defaults').lines)).toEqual(['proof fail ../skill-src/features/retries.md:5']);
    expect(unit(tree, 'retry-defaults').mark).toBe('fail');
    expect(lines(unit(tree, 'what-is-retried').lines)).toEqual(['origin pass test', 'proof fail ../src/a.test.ts:9']);
    expect(tree.elsewhere).toEqual([]);
  });

  it('a unit by hand is not covered by proof', () => {
    const tree = unitTree(report('check', { lint: lint(), proof: proof(), test: test([]) }));
    expect(unit(tree, 'never-disable-timeout')).toMatchObject({ coverage: 'none' });
    expect(lines(unit(tree, 'never-disable-timeout').lines)).toEqual(['origin none hand', 'test none']);
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
    expect(lines(unit(check, 'retry-defaults').lines)).toEqual(['origin pass test']);
  });

  it('with no `source`, has no proof lines', () => {
    const tree = unitTree(report('check', { lint: lint(), proof: { configured: false, ok: true }, test: test(specs()) }));
    expect(tree.layers).toEqual({ lint: true, proof: false, test: true });
    expect(tree.files.flatMap((f) => f.units).flatMap((u) => u.lines).some((l) => l.kind === 'origin' || (l.kind === 'missing' && l.layer === 'proof'))).toBe(false);
  });
});
