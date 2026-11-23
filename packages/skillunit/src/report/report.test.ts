import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../config.js';
import type { LintResult } from '../lint/types.js';
import type { ProofResult } from '../proof/layer.js';
import type { Report } from '../test/runner.js';
import { buildReport, render, REPORTERS, type CheckReport } from './index.js';

/** One report with every kind of finding, in a repository at /repo with the skill in skills/demo. */
const cwd = '/repo';
const skill = '/repo/skills/demo';

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
          expectedProb: 0.63,
          probabilities: { exact: 0.63, none: 0.35, loose: 0.02 },
          pass: false,
          weak: true,
          borderline: true,
          line: 19,
        },
        {
          ...verdict,
          id: 'user-asks-for-mutations',
          expect: 'explain',
          answer: 'none',
          confidence: 0.53,
          expectedProb: 0.34,
          probabilities: { none: 0.66, explain: 0.34, tool: 0 },
          pass: false,
          line: 30,
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
  summary: { tests: 4, passed: 2, borderline: 2, skipped: 1, usage: { input_tokens: 2000, output_tokens: 200 } },
};

const full: CheckReport = buildReport('check', { lint, test });
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
    expect(out).toContain('1) features/retries.md:24  retry-idempotent-only');
    expect(out).not.toContain('../');
  });

  it('table: a dry run', () => {
    const dry = buildReport('test', {
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

  it('table: test --changed with nothing to run', () => {
    const none = buildReport('test', { test: { ...test, ok: true, specs: [], summary: { tests: 0, passed: 0, borderline: 0, skipped: 7, usage: { input_tokens: 0, output_tokens: 0 } } } });
    expect(render(none, 'table', options)).toBe('\nTest  nothing to run\n  0 tests · 7 specs left out by --changed\n\nOK  test 0/0 passed\n');
  });

  it('table: test --changed names its base', () => {
    const changed = buildReport('test', { test: { ...test, ok: true, specs: [], changed: { ref: 'origin/main', commit: '0e3adc4f00000000' } } });
    expect(render(changed, 'table', options).split('\n')[1]).toBe('Test  nothing to run · changed since origin/main (0e3adc4)');
  });

  it('json: the report as it is, with the schema', () => {
    const json = JSON.parse(render(full, 'json', options));
    expect(json).toMatchObject({ schema: 4, command: 'check', ok: false });
    expect(json.test.specs[0].verdicts[1].borderline).toBe(true);
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
      reports: ['../../reports/junit.xml'],
      write: false,
      lock: { file: '../../skillunit.lock', exists: true, listed: 2, added: [], dropped: [], forgot: [], replaced: false, written: false },
      units: [
        { id: 'retry-idempotent-only', file: 'features/retries.md', line: 20, state: 'proved', listed: true, tests: [{ report: '../../reports/junit.xml', line: 4, title: 'retries > only GET [skill:retry-idempotent-only]', status: 'passed' }], fences: [{ id: 'retry-idempotent-only', line: 31, from: 'region', differs: true, written: false }] },
        { id: 'retry-delay', file: 'features/retries.md', line: 40, state: 'failed', listed: true, tests: [{ report: '../../reports/junit.xml', line: 7, title: 'retries > delay [skill:retry-delay]', status: 'failed' }], fences: [] },
        { id: 'pick-a-client', file: 'SKILL.md', line: 12, state: 'unproved', listed: false, tests: [], fences: [] },
        { id: 'await-every-request', file: 'SKILL.md', line: 30, state: 'failed', listed: true, tests: [], fences: [] },
      ],
      problems: [
        { file: 'features/retries.md', line: 32, unit: 'retry-idempotent-only', severity: 'error', rule: 'proof', message: 'this block is not what `src/retry.test.ts:12` gives, from line 1 of the block: the test gives `tf.get(url, { retry: 3 })`, the skill has `tf.get(url)`. Run `skillunit proof --write`' },
        { file: 'features/retries.md', line: 40, unit: 'retry-delay', severity: 'error', rule: 'proof', message: 'the test "retries > delay [skill:retry-delay]" (reports/junit.xml:7) failed: expected 500 to be 1000. It proves this unit, so the unit may no longer say what the code does' },
        { file: 'SKILL.md', line: 30, unit: 'await-every-request', severity: 'error', rule: 'proof', message: '`skillunit.lock` lists this unit as proved, and no test in the reports is tagged `[skill:await-every-request]`. Bring the test back, or run `skillunit proof --forget await-every-request` if the unit is no longer meant to be proved' },
        { file: '../../tmp/skill-proof/gone.json', line: 1, severity: 'warning', rule: 'proof', message: 'no block has `proof=gone`, so nothing uses `gone.json`' },
      ],
      summary: { units: 4, proved: 1, failed: 2, unproved: 1, tagged: 2, fences: 1, differ: 1, written: 0 },
    };
    const withProof = buildReport('proof', { proof });

    for (const reporter of REPORTERS) {
      it(`${reporter}: proved, failed and unproved units, with every kind of finding`, () => {
        expect(withProof.ok).toBe(false);
        expect(render(withProof, reporter, options)).toMatchSnapshot();
      });
    }

    it('table: the layer in the status line, after lint and before test', () => {
      const clean: ProofResult = { ...proof, ok: true, problems: [], summary: { ...proof.summary, written: 2 } };
      const report = buildReport('check', { lint: { ...lint, ok: true, problems: [] }, proof: clean, test: { ...test, ok: true, specs: [], summary: { ...test.summary, tests: 0, passed: 0, borderline: 0 } } });
      expect(render(report, 'table', options).trim().split('\n').at(-1)).toBe('OK  lint ok · proof ok, wrote 2 blocks · test 0/0 passed');
    });

    describe('what --write and --forget did to the lock', () => {
      const written = (lock: Partial<ProofResult['lock']>) =>
        buildReport('proof', { proof: { ...proof, ok: true, problems: [], lock: { ...proof.lock, written: true, ...lock } } });

      it('every reporter says it', () => {
        const report = written({ added: ['a', 'b'], dropped: ['c'] });
        const line = 'Updated skillunit.lock: added 2 units (a, b), dropped 1 (c).';
        expect(render(report, 'table', options)).toContain(`  ${line}\n`);
        expect(render(report, 'table', options).trim().split('\n').at(-1)).toBe('OK  proof ok, wrote the lock');
        expect(render(report, 'github', options)).toContain(`::notice title=SkillUnit proof::${line}\n`);
        expect(render(report, 'junit', options)).toContain(`<system-out>${line}</system-out>`);
        expect(JSON.parse(render(report, 'json', options)).proof.lock).toMatchObject({ added: ['a', 'b'], dropped: ['c'], written: true });
      });

      it('names each change', () => {
        const table = (lock: Partial<ProofResult['lock']>) => render(written(lock), 'table', options).split('\n').find((l) => l.includes('Updated'))?.trim();
        expect(table({ forgot: ['a', 'b'] })).toBe('Updated skillunit.lock: forgot 2 units (a, b).');
        expect(table({ replaced: true, added: ['a'] })).toBe('Updated skillunit.lock: replaced the lock of sync, added 1 unit (a).');
        expect(table({})).toBe('Updated skillunit.lock: sorted the ids.');
        expect(table({ written: false, added: ['a'] })).toBeUndefined();
      });
    });

    it('table: says when check ran with no proof key', () => {
      const report = buildReport('check', { lint: { ...lint, ok: true, problems: [] }, proof: { configured: false, ok: true } });
      const text = render(report, 'table', options);
      expect(text).toContain('Proof  not configured: no `proof` key in skillunit.yaml');
      expect(text.trim().split('\n').at(-1)).toBe('OK  lint ok · proof not configured');
      expect(render(report, 'github', options)).toBe('OK  lint ok · proof not configured\n');
      expect(JSON.parse(render(report, 'json', options)).proof).toEqual({ configured: false, ok: true });
    });
  });
});
