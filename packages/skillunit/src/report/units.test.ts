import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../config.js';
import type { Problem } from '../problems.js';
import type { ProofResult, UnitProof } from '../proof/layer.js';
import type { Verdict } from '../test/reader.js';
import type { Report, RequestReport } from '../test/runner.js';
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

/** `test`: proved by a test; `declared`: declared with no body; or what its test left. */
const unitProof = (id: string, how: 'test' | 'declared' | 'failed' | 'missing' = 'declared'): UnitProof => {
  const u = units.find((x) => x.id === id)!;
  const state = how === 'test' || how === 'declared' ? 'passed' : how;
  return {
    id,
    kind: state === 'passed' ? u.kind : null,
    from: how === 'declared' ? 'declared' : 'test',
    state,
    file: u.file,
    line: u.line,
    source: { file: `../skill-src/${u.file}`, line: u.line },
    ...(state === 'missing' ? {} : { test: { file: '../src/a.skill.test.ts', line: 3 } }),
  };
};

const proof = (overrides: Partial<ProofResult> = {}): ProofResult => ({
  configured: true,
  ok: true,
  skill,
  source: '/repo/skill-src',
  write: false,
  run: { command: 'npx vitest run', status: 0, ms: 1000 },
  units: [unitProof('await-every-request', 'test'), unitProof('retry-defaults', 'test'), unitProof('what-is-retried', 'test'), unitProof('retry-idempotent-only'), unitProof('never-disable-timeout')],
  files: [],
  problems: [],
  summary: { units: 5, proved: 3, declared: 2, failed: 0, missing: 0, values: 0, files: 4, differ: 0, written: 0, extra: 0 },
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
  declared: { file: '/repo/src/a.skill.test.ts', line },
  ...(unit ? { unit } : {}),
  ...extra,
});

const request = (file: string, verdicts: Verdict[], extra: Partial<RequestReport> = {}): RequestReport => ({
  file,
  sections: [],
  with: [],
  chars: 100,
  estimatedTokens: 100,
  verdicts,
  usage: { input_tokens: 0, output_tokens: 0 },
  ...extra,
});

const test = (requests: RequestReport[], overrides: Partial<Report> = {}): Report => {
  const all = requests.flatMap((s) => s.verdicts);
  return {
    ok: requests.every((s) => !s.error && s.verdicts.every((v) => v.pass)),
    skill,
    dryRun: false,
    thresholds: { ...DEFAULT_THRESHOLDS },
    requests,
    problems: [],
    summary: { tests: all.length, passed: all.filter((v) => v.pass).length, borderline: 0, skipped: 0, usage: { input_tokens: 0, output_tokens: 0 } },
    ...overrides,
  };
};

const requests = () => [
  request('SKILL.md', [verdict('await-the-call', 4, 'await-every-request'), verdict('which-file', 13)]),
  request('features/retries.md', [verdict('retry-delay-default', 4, 'retry-defaults'), verdict('post-no-retry', 10, 'retry-idempotent-only')]),
];

const report = (command: Command, layers: Omit<CheckReport, 'schema' | 'command' | 'ok'>) => buildReport(command, { units, ...layers });

const unit = (tree: UnitTree, id: string) => tree.files.flatMap((f) => f.units).find((u) => u.id === id)!;
const file = (tree: UnitTree, name: string) => tree.files.find((f) => f.file === name);
/** A line as `layer mark what`, short enough to compare. */
const brief = (l: Line): string => {
  switch (l.kind) {
    case 'proof':
      return `${l.kind} ${l.mark} ${l.problem.file}:${l.problem.line}`;
    case 'origin':
      return `origin ${l.mark} ${l.unit.from}`;
    case 'verdict':
      return `test ${l.mark} ${l.verdict.id}`;
    case 'request':
      return `request ${l.mark} ${l.request.file}`;
    case 'question':
      return `question ${l.mark} ${l.problem.id ?? '-'}`;
    case 'missing':
      return `${l.layer} none`;
  }
};
const lines = (ls: Line[]) => ls.map(brief);

describe('the report by unit', () => {
  const whole = unitTree(report('check', { proof: proof(), test: test(requests()) }));

  it('puts proof and tests under their unit, proof first', () => {
    expect(lines(unit(whole, 'await-every-request').lines)).toEqual(['origin pass test', 'test pass await-the-call']);
    expect(unit(whole, 'await-every-request').coverage).toBe('both');
  });

  it('marks a unit with proof only, tests only, or neither', () => {
    expect(lines(unit(whole, 'what-is-retried').lines)).toEqual(['origin pass test', 'test none']);
    expect(unit(whole, 'what-is-retried').coverage).toBe('proof');
    expect(lines(unit(whole, 'retry-idempotent-only').lines)).toEqual(['origin none declared', 'test pass post-no-retry']);
    expect(unit(whole, 'retry-idempotent-only').coverage).toBe('test');
    const neither = unit(whole, 'never-disable-timeout');
    expect(lines(neither.lines)).toEqual(['origin none declared', 'test none']);
    expect(neither).toMatchObject({ coverage: 'none', mark: 'warn' });
    expect(whole.coverage).toEqual({ both: 2, proof: 1, test: 1, none: 1 });
  });

  it('counts coverage only when check ran both layers over the whole skill', () => {
    expect(unitTree(report('test', { test: test(requests()) })).coverage).toBeNull();
    expect(unitTree(report('proof', { proof: proof() })).coverage).toBeNull();
    expect(unitTree(report('check', { proof: { configured: false, ok: true }, test: test(requests()) })).coverage).toBeNull();
    expect(unitTree(report('check', { proof: proof(), test: test(requests(), { changed: { ref: 'main', commit: 'abc' } }) })).coverage).toBeNull();
    const tree = unitTree(report('test', { test: test(requests()) }));
    expect(unit(tree, 'never-disable-timeout')).toMatchObject({ coverage: null, mark: 'pass' });
  });

  it('hangs a question of `ask()` under its file, before the units', () => {
    expect(lines(file(whole, 'SKILL.md')!.lines)).toEqual(['test pass which-file']);
  });

  it('hangs a question whose unit the report does not list under its file', () => {
    const tree = unitTree(report('test', { test: test([request('features/retries.md', [verdict('gone', 3, 'no-such-unit')])]) }));
    expect(lines(file(tree, 'features/retries.md')!.lines)).toEqual(['test pass gone']);
  });

  it('hangs a question about another file under its unit', () => {
    const tree = unitTree(report('test', { test: test([request('SKILL.md', [verdict('cross', 3, 'retry-defaults')])]) }));
    expect(file(tree, 'SKILL.md')!.lines).toEqual([]);
    expect(lines(unit(tree, 'retry-defaults').lines)).toEqual(['test pass cross']);
  });

  it('sends a finding about the settings or a record, and a request that could not run, elsewhere', () => {
    const problems: Problem[] = [
      { file: '../tmp/skill-units/a.json', line: 1, severity: 'error', message: 'not valid JSON' },
      { file: 'skillunit.yaml', line: 1, severity: 'error', message: 'proof.run left no unit' },
    ];
    const broken = request('SKILL.md', [], { error: 'no heading "Gone" in SKILL.md' });
    const tree = unitTree(report('check', { proof: proof({ ok: false, problems }), test: test([...requests(), broken]) }));
    expect(lines(tree.elsewhere)).toEqual(['proof fail ../tmp/skill-units/a.json:1', 'proof fail skillunit.yaml:1', 'request fail SKILL.md']);
  });

  it('puts a question that cannot be asked under its unit, and one with no unit elsewhere', () => {
    const problems = [
      { id: 'retry-defaults', unit: 'retry-defaults', declared: { file: '/repo/src/a.skill.test.ts', line: 3 }, message: 'the skill folder has no unit' },
      { id: 'which-file', declared: { file: '/repo/src/a.skill.test.ts', line: 9 }, message: 'not a file' },
      { message: '`proof.run` exited with 1' },
    ];
    const tree = unitTree(report('test', { test: test(requests(), { ok: false, problems }) }));
    expect(lines(unit(tree, 'retry-defaults').lines)).toEqual(['question fail retry-defaults', 'test pass retry-delay-default']);
    // A unit whose question could not be asked has a line of the test layer: it is not shown as missing one.
    expect(lines(unit(tree, 'what-is-retried').lines)).toEqual(['test none']);
    const failedOnly = unitTree(report('test', { test: test([], { ok: false, problems: [problems[0]!] }) }));
    expect(lines(unit(failedOnly, 'retry-defaults').lines)).toEqual(['question fail retry-defaults']);
    expect(unit(tree, 'retry-defaults').mark).toBe('fail');
    expect(lines(tree.elsewhere)).toEqual(['question fail which-file', 'question fail -']);
  });

  it('puts a finding about a unit under it, even when it is in the source or a test file', () => {
    const problems: Problem[] = [
      { file: '../skill-src/features/retries.md', line: 5, unit: 'retry-defaults', severity: 'error', message: 'the test of `retry-defaults` failed: expected 300' },
      { file: '../src/a.test.ts', line: 9, unit: 'what-is-retried', severity: 'error', message: 'no file of `source` has its slot' },
    ];
    const tree = unitTree(report('proof', { proof: proof({ ok: false, units: [unitProof('retry-defaults', 'failed'), unitProof('what-is-retried', 'test')], problems }) }));
    expect(lines(unit(tree, 'retry-defaults').lines)).toEqual(['proof fail ../skill-src/features/retries.md:5']);
    expect(unit(tree, 'retry-defaults').mark).toBe('fail');
    expect(lines(unit(tree, 'what-is-retried').lines)).toEqual(['origin pass test', 'proof fail ../src/a.test.ts:9']);
    expect(tree.elsewhere).toEqual([]);
  });

  it('a unit declared with no body is not covered by proof, and is never shown as proved', () => {
    const tree = unitTree(report('check', { proof: proof(), test: test([]) }));
    expect(unit(tree, 'never-disable-timeout')).toMatchObject({ coverage: 'none' });
    expect(lines(unit(tree, 'never-disable-timeout').lines)).toEqual(['origin none declared', 'test none']);
  });

  it('marks the tests of a dry run as ready', () => {
    const tree = unitTree(report('test', { test: test(requests(), { dryRun: true }) }));
    expect(lines(unit(tree, 'retry-defaults').lines)).toEqual(['test ready retry-delay-default']);
    expect(unit(tree, 'retry-defaults').mark).toBe('pass');
  });

  it('with --changed, keeps only the units and files that have a line', () => {
    const retries = [request('features/retries.md', [verdict('post-no-retry', 10, 'retry-idempotent-only')])];
    for (const t of [test(retries, { changed: { ref: 'main', commit: 'abc' } }), test(retries, { summary: { tests: 1, passed: 1, borderline: 0, skipped: 3, usage: { input_tokens: 0, output_tokens: 0 } } })]) {
      const tree = unitTree(report('test', { test: t }));
      expect(tree.partial).toBe(true);
      expect(tree.files.map((f) => [f.file, f.units.map((u) => u.id)])).toEqual([['features/retries.md', ['retry-idempotent-only']]]);
      expect(lines(unit(tree, 'retry-idempotent-only').lines)).toEqual(['test pass post-no-retry']);
    }
    // check --changed: proof ran over the whole skill, so every unit with a proof line stays.
    const check = unitTree(report('check', { proof: proof(), test: test(retries, { changed: { ref: 'main', commit: 'abc' } }) }));
    expect(check.files.flatMap((f) => f.units.map((u) => u.id))).toEqual(['await-every-request', 'retry-defaults', 'what-is-retried', 'retry-idempotent-only']);
    expect(lines(unit(check, 'retry-defaults').lines)).toEqual(['origin pass test']);
  });

  it('with no `source`, has no proof lines', () => {
    const tree = unitTree(report('check', { proof: { configured: false, ok: true }, test: test(requests()) }));
    expect(tree.layers).toEqual({ proof: false, test: true });
    expect(tree.files.flatMap((f) => f.units).flatMap((u) => u.lines).some((l) => l.kind === 'origin' || (l.kind === 'missing' && l.layer === 'proof'))).toBe(false);
  });
});
