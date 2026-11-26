import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../config.js';
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

const verdict = { scenario: 'The user asks to retry a POST.', question: 'What does the skill say?', weak: false, borderline: false };
const test: Report = {
  ok: false,
  skill,
  dryRun: false,
  thresholds: { ...DEFAULT_THRESHOLDS },
  requests: [
    {
      file: 'features/retries.md',
      sections: ['Rules'],
      with: [],
      chars: 1200,
      estimatedTokens: 700,
      model: 'jev-1.14.0',
      usage: { input_tokens: 2000, output_tokens: 200 },
      verdicts: [
        { ...verdict, id: 'post-retry', expect: 'stop', answer: 'stop', confidence: 0.92, expectedProb: 0.95, probabilities: { stop: 0.95, retry: 0.03, none: 0.02 }, pass: true, declared: { file: '/repo/src/retry.skill.test.ts', line: 3 }, unit: 'retry-idempotent-only' },
        { ...verdict, id: 'get-retry', expect: 'yes', answer: 'yes', confidence: 0.76, expectedProb: 0.76, pass: true, borderline: true, declared: { file: '/repo/src/retry.skill.test.ts', line: 12 } },
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
          declared: { file: '/repo/src/retry.skill.test.ts', line: 19 },
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
          declared: { file: '/repo/src/retry.skill.test.ts', line: 30 },
          unit: 'no-such-unit',
          variants: [0.34, 0.12, 0.72],
          variantsPass: [false, false, true],
        },
      ],
    },
    {
      file: 'SKILL.md',
      sections: ['Gone'],
      with: [],
      chars: 0,
      estimatedTokens: 0,
      verdicts: [],
      usage: { input_tokens: 0, output_tokens: 0 },
      error: 'no heading "Gone" in SKILL.md',
      questions: [{ id: 'which-heading', declared: { file: '/repo/src/skill.skill.test.ts', line: 8 } }],
    },
  ],
  problems: [{ id: 'which-file', declared: { file: '/repo/src/skill.skill.test.ts', line: 20 }, message: 'the question `which-file` is about features/gone.md, which is not a file in the skill folder' }],
  summary: { tests: 4, passed: 2, borderline: 2, skipped: 0, usage: { input_tokens: 2000, output_tokens: 200 } },
};

const full: CheckReport = buildReport('check', { units, test });
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
      test: { ...test, ok: true, problems: [], requests: [{ ...test.requests[0]!, verdicts: test.requests[0]!.verdicts.slice(0, 2) }], summary: { ...test.summary, tests: 2, passed: 2, borderline: 1, skipped: 0 } },
    });
    expect(clean.ok).toBe(true);
    expect(render(clean, 'table', options)).toMatchSnapshot();
    expect(render(clean, 'github', options)).toMatchSnapshot();
  });

  it('table: the files of a skill outside the current folder start from the skill folder', () => {
    const out = render(full, 'table', { cwd: '/elsewhere/project', color: false });
    expect(out).toContain('  features/retries.md\n');
    expect(out).not.toContain('../');
  });

  it('table: a dry run', () => {
    const dry = buildReport('test', {
      units,
      test: {
        ...test,
        ok: true,
        dryRun: true,
        problems: [],
        requests: [{ ...test.requests[0]!, model: undefined, verdicts: test.requests[0]!.verdicts.map((v) => ({ ...v, answer: '(dry run)', pass: true, weak: false, borderline: false })) }],
        summary: { ...test.summary, tests: 4, passed: 4, borderline: 0, skipped: 0, usage: { input_tokens: 0, output_tokens: 0 } },
      },
    });
    expect(render(dry, 'table', options)).toMatchSnapshot();
  });

  it('every reporter: a refused question fails with that reason, and no probabilities', () => {
    const refused = { ...verdict, id: 'post-retry', expect: 'stop', answer: '(refused)', confidence: 0, expectedProb: 0, pass: false, refused: true as const, declared: { file: '/repo/src/retry.skill.test.ts', line: 3 } };
    const report = buildReport('test', { test: { ...test, ok: false, problems: [], requests: [{ ...test.requests[0]!, verdicts: [refused] }] } });
    const table = render(report, 'table', options);
    expect(table).toContain('\n             got:       nothing: the model refused to answer\n');
    expect(table).not.toContain('P(yes)');
    expect(render(report, 'junit', options)).toContain('expected stop; the model refused to answer');
    expect(render(report, 'github', options)).toContain('::error file=src/retry.skill.test.ts,line=3,title=SkillUnit test%3A post-retry::expected stop; the model refused to answer%0A');
    expect(JSON.parse(render(report, 'json', options)).test.requests[0].verdicts[0]).toMatchObject({ answer: '(refused)', refused: true, pass: false });
  });

  it('every reporter: a tie for the top fails, and names the options that tied', () => {
    const tie = {
      ...verdict,
      id: 'post-retry',
      expect: 'stop',
      answer: 'stop',
      confidence: 0.5,
      expectedProb: 0.5,
      probabilities: { stop: 0.5, retry: 0.5, none: 0 },
      pass: false,
      borderline: true,
      tied: ['stop', 'retry'],
      declared: { file: '/repo/src/retry.skill.test.ts', line: 3 },
    };
    const report = buildReport('test', { test: { ...test, ok: false, problems: [], requests: [{ ...test.requests[0]!, verdicts: [tie] }] } });
    const got = 'expected stop, got a tie of stop and retry (probability 0.50, threshold 0.50, and a tie does not pass): stop 50%, retry 50%, none 0%';
    const table = render(report, 'table', options);
    expect(table).toContain('post-retry  a tie of stop and retry 0.50\n');
    expect(table).toContain('got:       a tie of stop and retry · probability 0.50, threshold 0.50 · a tie, which does not pass, borderline: the next run may pass it\n');
    expect(table).not.toContain('right answer');
    expect(render(report, 'junit', options)).toContain(`<failure message="${got}">`);
    expect(render(report, 'github', options)).toContain(`::error file=src/retry.skill.test.ts,line=3,title=SkillUnit test%3A post-retry::${got.replace(/%/g, '%25')}%0A`);
    expect(JSON.parse(render(report, 'json', options)).test.requests[0].verdicts[0]).toMatchObject({ answer: 'stop', tied: ['stop', 'retry'], pass: false, weak: false });
  });

  it('table: how many phrasings passed, since most of them must', () => {
    expect(render(full, 'table', options)).toContain('phrasings: 0.34 fail  0.12 fail  0.72 pass (probability of "explain" for each; 1 of 3 pass, and most must)\n');
  });

  it('table: test --changed with nothing to ask', () => {
    const none = buildReport('test', { test: { ...test, ok: true, problems: [], requests: [], changed: { ref: 'main', commit: 'abc1234def' }, summary: { tests: 0, passed: 0, borderline: 0, skipped: 7, usage: { input_tokens: 0, output_tokens: 0 } } } });
    expect(render(none, 'table', options)).toBe('\nUnits  test nothing to ask · changed since main (abc1234)\n\n  0 tests · 7 questions left out by --changed\n\nOK  test asked nothing: no question is about a file changed since main (abc1234)\n');
  });

  it('table: test --changed names its base', () => {
    const changed = buildReport('test', { test: { ...test, ok: true, problems: [], requests: [], changed: { ref: 'origin/main', commit: '0e3adc4f00000000' } } });
    expect(render(changed, 'table', options).split('\n')[1]).toBe('Units  test nothing to ask · changed since origin/main (0e3adc4)');
  });

  it('json: the report as it is, with the schema', () => {
    const json = JSON.parse(render(full, 'json', options));
    expect(json).toMatchObject({ schema: 7, command: 'check', ok: false });
    expect(json.test.requests[0].verdicts[1].borderline).toBe(true);
    expect(json.units).toEqual(units);
  });

  describe('table: the report by unit', () => {
    const out = render(full, 'table', options);

    it('names each failing line once at the end, as file › unit › line, after which only the status line comes', () => {
      const tail = out.slice(out.indexOf('\nFailed\n'));
      expect(tail).toBe(
        [
          '\nFailed',
          '  skills/demo/features/retries.md › src/retry.skill.test.ts:30  user-asks-for-mutations',
          '  skills/demo/features/retries.md › retry-delay › src/retry.skill.test.ts:19  exact-command',
          '  src/skill.skill.test.ts:20  which-file',
          '  skills/demo/SKILL.md § Gone  could not run',
          '',
          'FAILED  test 2/4 passed (1 request could not run, 1 problem, 2 borderline)',
          '',
        ].join('\n'),
      );
      expect(out).not.toMatch(/^(Failures|Borderline|Warnings)$/m);
    });

    it('shows the details of a failure under its line, and the number of a borderline pass', () => {
      expect(out).toContain(
        [
          '    test   ~ src/retry.skill.test.ts:12  get-retry  yes P(yes) 0.76',
          '             P(yes) 0.76, needs ≥ 0.70 · borderline: the next run may fail it',
        ].join('\n'),
      );
      expect(out).toContain(
        [
          '      test   ✗ src/retry.skill.test.ts:19  exact-command  exact 0.44',
          '               scenario:  The user asks to retry a POST.',
          '               question:  What does the skill say?',
          '               expected:  exact',
          '               got:       exact · probability 0.44, threshold 0.50 · right answer, under the threshold, borderline: the next run may pass it',
          '                          exact 44% · none 40% · loose 16%',
        ].join('\n'),
      );
      expect(out).toContain('2 borderline: within 0.13 of the threshold');
    });

    it('puts a question whose unit the skill does not list under its file', () => {
      expect(out).toContain('    test   ✗ src/retry.skill.test.ts:30  user-asks-for-mutations  none 0.66\n             scenario:');
    });

    it('names where a question that cannot be asked is declared, and the questions of a request that could not run', () => {
      expect(out).toContain('  test   ✗ src/skill.skill.test.ts:20  which-file  the question `which-file` is about features/gone.md, which is not a file in the skill folder');
      expect(out).toContain('  test   ✗ skills/demo/SKILL.md § Gone  could not run\n           no heading "Gone" in SKILL.md\n           questions: which-heading (src/skill.skill.test.ts:8)');
    });

    it('carries the state in the mark, so the output reads the same without colour', () => {
      expect(out).toContain('    test   ~ src/retry.skill.test.ts:12  get-retry');
      expect(out).toContain('    pick-a-client  decision\n');
    });

    it('--compact: one row per unit, with what failed under it', () => {
      const proofOf = (id: string, from: 'test' | 'declared'): ProofResult['units'][number] => ({
        id,
        kind: units.find((u) => u.id === id)!.kind,
        from,
        state: 'passed',
        file: units.find((u) => u.id === id)!.file,
        line: 1,
        source: { file: '../../skills-src/demo/SKILL.md', line: 3 },
        test: { file: from === 'test' ? '../../src/retry.test.ts' : '../../src/skill.skill.test.ts', line: 12 },
      });
      const proof: ProofResult = {
        configured: true,
        ok: true,
        skill,
        source: '/repo/skills-src/demo',
        write: false,
        run: { command: 'npx vitest run', status: 0, ms: 2300 },
        units: [proofOf('pick-a-client', 'declared'), proofOf('await-every-request', 'declared'), proofOf('retry-idempotent-only', 'test'), proofOf('retry-delay', 'declared')],
        files: [],
        problems: [],
        summary: { units: 4, proved: 1, declared: 3, failed: 0, missing: 0, values: 0, files: 2, differ: 0, written: 0, extra: 0 },
      };
      const report = buildReport('check', { units, proof, test });
      expect(render(report, 'table', { ...options, compact: true })).toMatchSnapshot();
    });
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
        { id: 'pick-a-client', kind: 'decision', from: 'declared', state: 'passed', file: 'SKILL.md', line: 12, source: { file: '../../skills-src/demo/SKILL.md', line: 12 }, test: { file: '../../src/skill.skill.test.ts', line: 5 } },
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
          message: 'this line is not what the build gives: the build has `Do: retry GET only.`, the skill has `Do: retry anything.`. Run `skillunit proof --write` to update the skill. To change this text, change where it comes from: the skill folder is built.',
          origin: { kind: 'test', file: '../../src/retry.test.ts', line: 12, unit: 'retry-idempotent-only' },
        },
        { file: '../../skills-src/demo/features/retries.md', line: 30, unit: 'retry-delay', severity: 'error', message: 'the test of `retry-delay` (src/retry.test.ts:40) failed, so it left no unit: expected 500 to be 1000' },
        { file: '../../skills-src/demo/SKILL.md', line: 28, unit: 'await-every-request', severity: 'error', message: 'no test left the unit `await-every-request`: its test was skipped or deleted, or did not run' },
        { file: '../../skillunit.yaml', line: 3, severity: 'warning', message: '`proof.format` failed on the build of SKILL.md' },
      ],
      summary: { units: 4, proved: 1, declared: 1, failed: 1, missing: 1, values: 2, files: 2, differ: 1, written: 0, extra: 0 },
    };
    const withProof = buildReport('proof', { units, proof });

    for (const reporter of REPORTERS) {
      it(`${reporter}: units proved by a test and declared without one, with every kind of finding`, () => {
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

    it('table: the proof in the status line, before test', () => {
      const clean: ProofResult = { ...proof, ok: true, problems: [], summary: { ...proof.summary, written: 2 } };
      const report = buildReport('check', { proof: clean, test: { ...test, ok: true, problems: [], requests: [], summary: { ...test.summary, tests: 0, passed: 0, borderline: 0 } } });
      expect(render(report, 'table', options).trim().split('\n').at(-1)).toBe('OK  proof ok, wrote 2 files · test 0/0 passed');
    });

    it('github: escapes the characters workflow commands use', () => {
      const odd = buildReport('proof', { proof: { ...proof, problems: [{ file: 'a,b:c.md', line: 1, severity: 'error', message: '100% broken\nsecond line' }] } });
      expect(render(odd, 'github', options).split('\n')[0]).toBe('::error file=skills/demo/a%2Cb%3Ac.md,line=1,title=SkillUnit proof::100%25 broken%0Asecond line');
    });

    it('every reporter gives the summary of the build', () => {
      const summary = '4 units · 1 proved by a test, 1 failed, 1 missing · 1 declared without one · 2 values in prose · 1 file out of date';
      expect(render(withProof, 'table', options)).toContain(`  ${summary}\n`);
      expect(render(withProof, 'github', options)).toContain(`::notice title=SkillUnit proof::${summary}\n`);
      expect(JSON.parse(render(withProof, 'json', options)).proof.summary).toMatchObject({ units: 4, proved: 1, declared: 1, values: 2 });
      expect(render(withProof, 'junit', options)).toContain('<property name="from" value="test"/>');
    });

    it('a failed model test says where its unit is declared', () => {
      const built = units.map((u) => (u.id === 'retry-delay' ? { ...u, from: 'test' as const, test: { file: '../../src/retry.test.ts', line: 40 } } : { ...u, from: 'declared' as const }));
      const report = buildReport('check', { units: built, test });
      const origin = 'the unit `retry-delay` comes from its test, src/retry.test.ts:40';
      expect(render(report, 'github', options)).toContain(`%0A${origin}`);
      expect(render(report, 'junit', options)).toContain(origin);
      expect(JSON.parse(render(report, 'json', options)).units.find((u: { id: string }) => u.id === 'retry-delay')).toEqual({ id: 'retry-delay', kind: 'fact', file: 'features/retries.md', line: 40, from: 'test', test: { file: '../../src/retry.test.ts', line: 40 } });
      // A unit declared with no body is named as such.
      const declared = built.map((u) => (u.id === 'retry-delay' ? { ...u, from: 'declared' as const } : u));
      const out = render(buildReport('check', { units: declared, test }), 'github', options);
      expect(out).not.toContain('comes from its test');
      expect(out).toContain('the unit `retry-delay` is declared, with no test, at src/retry.test.ts:40');
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
      const report = buildReport('check', { units, proof: { configured: false, ok: true } });
      const text = render(report, 'table', options);
      expect(text).toContain('Units  proof not configured\n');
      expect(text).not.toContain('proof  ');
      expect(text.trim().split('\n').at(-1)).toBe('OK  proof not configured');
      expect(render(report, 'github', options)).toBe('OK  proof not configured\n');
      expect(JSON.parse(render(report, 'json', options)).proof).toEqual({ configured: false, ok: true });
    });
  });
});
