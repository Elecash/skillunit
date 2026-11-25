import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../config.js';
import type { LintResult } from '../lint/types.js';
import type { ProofResult } from '../proof/layer.js';
import type { Report } from '../test/runner.js';
import { buildReport, render, REPORTERS, type CheckReport, type ReportUnit } from './index.js';

/** One report with every kind of finding, in a repository at /repo with the skill in skills/demo. */
const cwd = '/repo';
const skill = '/repo/skills/demo';

/** The units of the skill, as the CLI lists them in every report. */
const units: ReportUnit[] = [
  { id: 'pick-a-client', kind: 'decision', file: 'SKILL.md', line: 12 },
  { id: 'await-every-request', kind: 'rule', file: 'SKILL.md', line: 30 },
  { id: 'retry-idempotent-only', kind: 'rule', file: 'features/retries.md', line: 20 },
  { id: 'retry-delay', kind: 'fact', file: 'features/retries.md', line: 40 },
];

const lint: LintResult = {
  skill,
  files: ['SKILL.md', 'features/retries.md'],
  ok: false,
  problems: [
    {
      file: 'features/retries.md',
      line: 24,
      unit: 'retry-idempotent-only',
      severity: 'error',
      rule: 'check',
      message: "breaks `retry-idempotent-only`: `post('/users', {}, { retry` matches its `Check` (features/retries.md:35)",
    },
    { file: 'features/retries.md', line: 3, severity: 'warning', rule: 'index', message: '312 lines; above about 300, look for a split into files of one task each' },
  ],
  summary: {
    files: 2,
    units: 3,
    typescript: '5.6.3',
    typeChecked: 6,
    notParsed: 0,
    off: [],
    commandChecked: 0,
    unchecked: { sh: 2 },
    noCheck: 1,
    notConfigured: 0,
    undeclared: [],
  },
};

const verdict = { scenario: 'The user asks to retry a POST.', question: 'What does the skill say?', weak: false, borderline: false };
const test: Report = {
  ok: false,
  skill,
  dryRun: false,
  thresholds: { ...DEFAULT_THRESHOLDS },
  specs: [
    {
      spec: '/repo/skills/demo/specs/retries.yaml',
      file: 'features/retries.md',
      sections: ['Rules'],
      with: [],
      chars: 1200,
      estimatedTokens: 700,
      model: 'jev-1.14.0',
      usage: { input_tokens: 2000, output_tokens: 200 },
      verdicts: [
        { ...verdict, id: 'post-retry', expect: 'stop', answer: 'stop', confidence: 0.92, expectedProb: 0.95, probabilities: { stop: 0.95, retry: 0.03, none: 0.02 }, pass: true, line: 3, unit: 'retry-idempotent-only' },
        { ...verdict, id: 'get-retry', expect: 'yes', answer: 'yes', confidence: 0.76, expectedProb: 0.76, pass: true, borderline: true, line: 12 },
        {
          ...verdict,
          id: 'exact-command',
          expect: 'exact',
          answer: 'exact',
          confidence: 0.44,
          expectedProb: 0.44,
          probabilities: { exact: 0.44, none: 0.4, loose: 0.16 },
          pass: false,
          weak: true,
          borderline: true,
          line: 19,
          unit: 'retry-delay',
        },
        {
          ...verdict,
          id: 'user-asks-for-mutations',
          expect: 'explain',
          answer: 'none',
          confidence: 0.66,
          expectedProb: 0.34,
          probabilities: { none: 0.66, explain: 0.34, tool: 0 },
          pass: false,
          line: 30,
          unit: 'no-such-unit',
          variants: [0.34, 0.41, 0.72],
        },
      ],
    },
    {
      spec: '/repo/skills/demo/specs/broken.yaml',
      file: 'SKILL.md',
      sections: [],
      with: [],
      chars: 0,
      estimatedTokens: 0,
      verdicts: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      error: 'no heading "Gone" in SKILL.md',
    },
  ],
  summary: { tests: 4, passed: 2, borderline: 2, skipped: 0, usage: { input_tokens: 2000, output_tokens: 200 } },
};

const full: CheckReport = buildReport('check', { units, lint, test });
const options = { cwd, color: false };

describe('reporters', () => {
  for (const reporter of REPORTERS) {
    it(`${reporter}: every layer with every kind of finding`, () => {
      expect(render(full, reporter, options)).toMatchSnapshot();
    });
  }

  it('table: colour on a terminal', () => {
    expect(render(full, 'table', { cwd, color: true })).toMatchSnapshot();
  });

  it('table and github: a clean check', () => {
    const clean = buildReport('check', {
      units,
      lint: { ...lint, ok: true, problems: [] },
      test: { ...test, ok: true, specs: [{ ...test.specs[0]!, verdicts: test.specs[0]!.verdicts.slice(0, 2) }], summary: { ...test.summary, tests: 2, passed: 2, borderline: 1, skipped: 0 } },
    });
    expect(clean.ok).toBe(true);
    expect(render(clean, 'table', options)).toMatchSnapshot();
    expect(render(clean, 'github', options)).toMatchSnapshot();
  });

  it('table: lint findings by file, at most three per example, each line once, and counted by code', () => {
    const type = (line: number, code: string, example: number): LintResult['problems'][number] => ({
      file: 'features/fragments.md',
      line,
      severity: 'error',
      rule: 'types',
      message: `does not type-check: ${code} message for line ${line}`,
      code,
      example,
    });
    const many = buildReport('lint', {
      lint: {
        ...lint,
        files: ['SKILL.md', 'features/retries.md', 'features/fragments.md'],
        problems: [
          ...lint.problems,
          // Five findings in the example at line 10, one of them twice; one in the example at line 20.
          type(11, 'TS2304', 10),
          type(11, 'TS2304', 10),
          type(12, 'TS2304', 10),
          type(13, 'TS2451', 10),
          type(14, 'TS2304', 10),
          type(15, 'TS2322', 10),
          type(21, 'TS2322', 20),
        ],
      },
    });
    const out = render(many, 'table', options);
    expect(out).toContain(
      [
        '  2) skills/demo/features/fragments.md:11  -  does not type-check: TS2304 message for line 11',
        '     skills/demo/features/fragments.md:12  -  does not type-check: TS2304 message for line 12',
        '     skills/demo/features/fragments.md:13  -  does not type-check: TS2451 message for line 13',
        '       +2 more in this example',
        '     skills/demo/features/fragments.md:21  -  does not type-check: TS2322 message for line 21',
      ].join('\n'),
    );
    expect(out).toContain('Type problems by code: TS2304 4 · TS2322 2 · TS2451 1');
    expect(out).toContain('  ✓ 1 other file clean');
  });

  it('table: a skill outside the current folder is named once, and its findings start from it', () => {
    const out = render(full, 'table', { cwd: '/elsewhere/project', color: false });
    expect(out).toContain('Lint  /repo/skills/demo');
    expect(out).toContain('  features/retries.md\n');
    expect(out).toContain('      lint   ✗ features/retries.md:24  breaks `retry-idempotent-only`');
    expect(out).not.toContain('../');
  });

  it('table: a dry run', () => {
    const dry = buildReport('test', {
      units,
      test: {
        ...test,
        ok: true,
        dryRun: true,
        specs: [{ ...test.specs[0]!, model: undefined, verdicts: test.specs[0]!.verdicts.map((v) => ({ ...v, answer: '(dry run)', pass: true, weak: false, borderline: false })) }],
        summary: { ...test.summary, tests: 4, passed: 4, borderline: 0, skipped: 0, usage: { input_tokens: 0, output_tokens: 0 } },
      },
    });
    expect(render(dry, 'table', options)).toMatchSnapshot();
  });

  it('every reporter: a refused question fails with that reason, and no probabilities', () => {
    const refused = { ...verdict, id: 'post-retry', expect: 'stop', answer: '(refused)', confidence: 0, expectedProb: 0, pass: false, refused: true as const, line: 3 };
    const report = buildReport('test', { test: { ...test, ok: false, specs: [{ ...test.specs[0]!, verdicts: [refused] }] } });
    const table = render(report, 'table', options);
    expect(table).toContain('\n             got:       nothing: the model refused to answer\n');
    expect(table).not.toContain('P(yes)');
    expect(render(report, 'junit', options)).toContain('expected stop; the model refused to answer');
    expect(render(report, 'github', options)).toContain('::error file=skills/demo/specs/retries.yaml,line=3,title=SkillUnit test%3A post-retry::expected stop; the model refused to answer%0A');
    expect(JSON.parse(render(report, 'json', options)).test.specs[0].verdicts[0]).toMatchObject({ answer: '(refused)', refused: true, pass: false });
  });

  it('table: test --changed with nothing to run', () => {
    const none = buildReport('test', { test: { ...test, ok: true, specs: [], summary: { tests: 0, passed: 0, borderline: 0, skipped: 7, usage: { input_tokens: 0, output_tokens: 0 } } } });
    expect(render(none, 'table', options)).toBe('\nUnits  test nothing to run\n\n  0 tests · 7 specs left out by --changed\n\nOK  test 0/0 passed\n');
  });

  it('table: test --changed names its base', () => {
    const changed = buildReport('test', { test: { ...test, ok: true, specs: [], changed: { ref: 'origin/main', commit: '0e3adc4f00000000' } } });
    expect(render(changed, 'table', options).split('\n')[1]).toBe('Units  test nothing to run · changed since origin/main (0e3adc4)');
  });

  it('json: the report as it is, with the schema', () => {
    const json = JSON.parse(render(full, 'json', options));
    expect(json).toMatchObject({ schema: 5, command: 'check', ok: false });
    expect(json.test.specs[0].verdicts[1].borderline).toBe(true);
    expect(json.units).toEqual(units);
  });

  describe('table: the report by unit', () => {
    const out = render(full, 'table', options);

    it('names each failing line once at the end, as file › unit › line, after which only the status line comes', () => {
      const tail = out.slice(out.indexOf('\nFailed\n'));
      expect(tail).toBe(
        [
          '\nFailed',
          '  skills/demo/features/retries.md › skills/demo/specs/retries.yaml:30  user-asks-for-mutations',
          '  skills/demo/features/retries.md › retry-idempotent-only › lint skills/demo/features/retries.md:24',
          '  skills/demo/features/retries.md › retry-delay › skills/demo/specs/retries.yaml:19  exact-command',
          '  skills/demo/specs/broken.yaml  could not run',
          '',
          'FAILED  lint 1 error, 1 warning · test 2/4 passed (1 spec could not run, 2 borderline)',
          '',
        ].join('\n'),
      );
      expect(out).not.toMatch(/^(Failures|Borderline|Warnings)$/m);
    });

    it('shows the details of a failure under its line, and the number of a borderline pass', () => {
      expect(out).toContain(
        [
          '    test   ~ skills/demo/specs/retries.yaml:12  get-retry  yes P(yes) 0.76',
          '             P(yes) 0.76, needs ≥ 0.70 · borderline: the next run may fail it',
        ].join('\n'),
      );
      expect(out).toContain(
        [
          '      test   ✗ skills/demo/specs/retries.yaml:19  exact-command  exact 0.44',
          '               scenario:  The user asks to retry a POST.',
          '               question:  What does the skill say?',
          '               expected:  exact',
          '               got:       exact · probability 0.44, threshold 0.50 · right answer, under the threshold, borderline: the next run may pass it',
          '                          exact 44% · none 40% · loose 16%',
        ].join('\n'),
      );
      expect(out).toContain('2 borderline: within 0.13 of the threshold');
    });

    it('notes a `unit:` that names no unit of the skill, under the test', () => {
      expect(out).toContain('user-asks-for-mutations  none 0.66\n             unit: no-such-unit names no unit of the skill\n             scenario:');
    });

    it('carries the state in the mark, so the output reads the same without colour', () => {
      expect(out).toContain('    test   ~ skills/demo/specs/retries.yaml:12  get-retry');
      expect(out).toContain('    pick-a-client  decision\n');
    });

    it('--compact: one row per unit, with what failed under it', () => {
      const proofOf = (id: string, from: 'test' | 'hand'): ProofResult['units'][number] => ({
        id,
        kind: units.find((u) => u.id === id)!.kind,
        from,
        state: from === 'test' ? 'passed' : 'hand',
        file: units.find((u) => u.id === id)!.file,
        line: 1,
        source: { file: '../../skills-src/demo/SKILL.md', line: 3 },
        ...(from === 'test' ? { test: { file: '../../src/retry.test.ts', line: 12 } } : {}),
      });
      const proof: ProofResult = {
        configured: true,
        ok: true,
        skill,
        source: '/repo/skills-src/demo',
        write: false,
        run: { command: 'npx vitest run', status: 0, ms: 2300 },
        units: [proofOf('pick-a-client', 'hand'), proofOf('await-every-request', 'hand'), proofOf('retry-idempotent-only', 'test'), proofOf('retry-delay', 'hand')],
        files: [],
        problems: [],
        summary: { units: 4, fromTests: 1, byHand: 3, failed: 0, missing: 0, values: 0, files: 2, differ: 0, written: 0, extra: 0 },
      };
      const report = buildReport('check', { units, lint, proof, test });
      expect(render(report, 'table', { ...options, compact: true })).toMatchSnapshot();
    });
  });

  describe('names that nothing declares', () => {
    const names = ['resend', 'domainId', 'audienceId', 'apiKey', 'from', 'to', 'subject'];
    const undeclared = names.map((name, i) => ({ name, count: [120, 12, 9, 4, 2, 1, 1][i]! }));
    const report = buildReport('lint', { lint: { ...lint, summary: { ...lint.summary, undeclared } } });
    const SENTENCE = 'A `Setup:` block in `SKILL.md` declares them once for every file of the skill: https://github.com/Elecash/skillunit/blob/main/docs/style-guide.md#setup';

    it('table: the five most frequent, with their counts, and where to declare them', () => {
      const out = render(report, 'table', options);
      expect(out).toContain(`Names nothing declares: resend 120 · domainId 12 · audienceId 9 · apiKey 4 · from 2, and 2 more\n${SENTENCE}`);
    });

    it('github: the same, as a notice', () => {
      const out = render(report, 'github', options);
      expect(out).toContain(`::notice title=SkillUnit lint::Names nothing declares: resend 120 · domainId 12 · audienceId 9 · apiKey 4 · from 2, and 2 more. ${SENTENCE}`);
    });

    it('json: every name, under the summary', () => {
      expect(JSON.parse(render(report, 'json', options)).lint.summary.undeclared).toEqual(undeclared);
    });

    it('says nothing when every name is declared', () => {
      for (const reporter of ['table', 'github'] as const) expect(render(full, reporter, options)).not.toContain('Names nothing declares');
    });
  });

  it('github: escapes the characters workflow commands use', () => {
    const odd = buildReport('lint', {
      lint: { ...lint, problems: [{ file: 'a,b:c.md', line: 1, severity: 'error', rule: 'index', message: '100% broken\nsecond line' }] },
    });
    expect(render(odd, 'github', options).split('\n')[0]).toBe('::error file=skills/demo/a%2Cb%3Ac.md,line=1,title=SkillUnit lint::100%25 broken%0Asecond line');
  });

  describe('the proof layer', () => {
    const proof: ProofResult = {
      configured: true,
      ok: false,
      skill,
      source: '/repo/skills-src/demo',
      write: false,
      run: { command: 'npx vitest run', status: 1, ms: 4200 },
      units: [
        { id: 'retry-idempotent-only', kind: 'rule', from: 'test', state: 'passed', file: 'features/retries.md', line: 20, source: { file: '../../skills-src/demo/features/retries.md', line: 20 }, test: { file: '../../src/retry.test.ts', line: 12 } },
        { id: 'retry-delay', kind: null, from: 'test', state: 'failed', file: 'features/retries.md', line: 40, source: { file: '../../skills-src/demo/features/retries.md', line: 30 }, test: { file: '../../src/retry.test.ts', line: 40 }, error: 'expected 500 to be 1000' },
        { id: 'pick-a-client', kind: 'decision', from: 'hand', state: 'hand', file: 'SKILL.md', line: 12, source: { file: '../../skills-src/demo/SKILL.md', line: 12 } },
        { id: 'await-every-request', kind: null, from: 'test', state: 'missing', file: 'SKILL.md', line: 30, source: { file: '../../skills-src/demo/SKILL.md', line: 28 } },
      ],
      files: [
        { file: 'SKILL.md', state: 'broken' },
        { file: 'features/retries.md', state: 'differs' },
      ],
      problems: [
        {
          file: 'features/retries.md',
          line: 22,
          unit: 'retry-idempotent-only',
          severity: 'error',
          rule: 'proof',
          message: 'this line is not what the build gives: the build has `Do: retry GET only.`, the skill has `Do: retry anything.`. Run `skillunit proof --write` to update the skill. To change this text, change where it comes from: the skill folder is built.',
          origin: { kind: 'test', file: '../../src/retry.test.ts', line: 12, unit: 'retry-idempotent-only' },
        },
        { file: '../../skills-src/demo/features/retries.md', line: 30, unit: 'retry-delay', severity: 'error', rule: 'proof', message: 'the test of `retry-delay` (src/retry.test.ts:40) failed, so it left no unit: expected 500 to be 1000' },
        { file: '../../skills-src/demo/SKILL.md', line: 28, unit: 'await-every-request', severity: 'error', rule: 'proof', message: 'no test left the unit `await-every-request`: its test was skipped or deleted, or did not run' },
        { file: '../../skillunit.yaml', line: 3, severity: 'warning', rule: 'proof', message: '`proof.format` failed on the build of SKILL.md' },
      ],
      summary: { units: 4, fromTests: 1, byHand: 1, failed: 1, missing: 1, values: 2, files: 2, differ: 1, written: 0, extra: 0 },
    };
    const withProof = buildReport('proof', { units, proof });

    for (const reporter of REPORTERS) {
      it(`${reporter}: units from tests and by hand, with every kind of finding`, () => {
        expect(withProof.ok).toBe(false);
        expect(render(withProof, reporter, options)).toMatchSnapshot();
      });
    }

    it('every reporter says where the line of a finding comes from', () => {
      const from = 'from the test of `retry-idempotent-only`, src/retry.test.ts:12';
      expect(render(withProof, 'table', options)).toContain(from);
      expect(render(withProof, 'github', options)).toContain(`%0A${from}`);
      expect(render(withProof, 'junit', options)).toContain(from);
      expect(JSON.parse(render(withProof, 'json', options)).proof.problems[0].origin).toEqual({ kind: 'test', file: '../../src/retry.test.ts', line: 12, unit: 'retry-idempotent-only' });
    });

    it('table: the layer in the status line, after lint and before test', () => {
      const clean: ProofResult = { ...proof, ok: true, problems: [], summary: { ...proof.summary, written: 2 } };
      const report = buildReport('check', { lint: { ...lint, ok: true, problems: [] }, proof: clean, test: { ...test, ok: true, specs: [], summary: { ...test.summary, tests: 0, passed: 0, borderline: 0 } } });
      expect(render(report, 'table', options).trim().split('\n').at(-1)).toBe('OK  lint ok · proof ok, wrote 2 files · test 0/0 passed');
    });

    it('every reporter gives the summary of the build', () => {
      const summary = '4 units · 1 from tests, 1 failed, 1 missing · 1 by hand · 2 values in prose · 1 file out of date';
      expect(render(withProof, 'table', options)).toContain(`  ${summary}\n`);
      expect(render(withProof, 'github', options)).toContain(`::notice title=SkillUnit proof::${summary}\n`);
      expect(JSON.parse(render(withProof, 'json', options)).proof.summary).toMatchObject({ units: 4, fromTests: 1, byHand: 1, values: 2 });
      expect(render(withProof, 'junit', options)).toContain('<property name="from" value="test"/>');
    });

    it('a failed model test says where its unit comes from, when the unit is built from a test', () => {
      const built = units.map((u) => (u.id === 'retry-delay' ? { ...u, from: 'test' as const, test: { file: '../../src/retry.test.ts', line: 40 } } : { ...u, from: 'hand' as const }));
      const report = buildReport('check', { units: built, lint, test });
      const origin = 'the unit `retry-delay` comes from its test, src/retry.test.ts:40';
      expect(render(report, 'github', options)).toContain(`%0A${origin}`);
      expect(render(report, 'junit', options)).toContain(origin);
      expect(JSON.parse(render(report, 'json', options)).units.find((u: { id: string }) => u.id === 'retry-delay')).toEqual({ id: 'retry-delay', kind: 'fact', file: 'features/retries.md', line: 40, from: 'test', test: { file: '../../src/retry.test.ts', line: 40 } });
      // A unit by hand has nothing to point at.
      expect(render(buildReport('check', { units: built.map((u) => ({ ...u, from: 'hand' as const, test: undefined })), lint, test }), 'github', options)).not.toContain('comes from its test');
    });

    it('github: annotation paths start at the repository root, messages keep the folder the command ran in', () => {
      const out = render(withProof, 'github', { cwd: '/repo/skills', root: '/repo', color: false });
      expect(out).toContain('::error file=skills/demo/features/retries.md,line=22,');
      // Outside the folder the command ran in, a path in a message is shown whole.
      expect(out).toContain('from the test of `retry-idempotent-only`, /repo/src/retry.test.ts:12');
    });

    it('every reporter says what --write wrote', () => {
      const report = buildReport('proof', { proof: { ...proof, ok: true, problems: [], files: [{ file: 'SKILL.md', state: 'written' }, { file: 'features/retries.md', state: 'same' }], summary: { ...proof.summary, written: 1 } } });
      const line = 'Wrote 1 file of skills/demo: SKILL.md.';
      expect(render(report, 'table', options)).toContain(`  ${line}\n`);
      expect(render(report, 'github', options)).toContain(`::notice title=SkillUnit proof::${line}\n`);
      expect(render(report, 'junit', options)).toContain(`<system-out>${line}</system-out>`);
    });

    it('table: says when check ran with no source', () => {
      const report = buildReport('check', { units, lint: { ...lint, ok: true, problems: [] }, proof: { configured: false, ok: true } });
      const text = render(report, 'table', options);
      expect(text).toContain('Units  proof not configured\n');
      expect(text).not.toContain('proof  ');
      expect(text.trim().split('\n').at(-1)).toBe('OK  lint ok · proof not configured');
      expect(render(report, 'github', options)).toBe('OK  lint ok · proof not configured\n');
      expect(JSON.parse(render(report, 'json', options)).proof).toEqual({ configured: false, ok: true });
    });
  });
});
