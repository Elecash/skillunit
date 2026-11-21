import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../config.js';
import type { LintResult } from '../lint/types.js';
import type { SyncResult } from '../sync/sync.js';
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
    wrongCode: { checked: 2, unchecked: 0 },
  },
};

const REVIEW = 'read the code against the unit, edit the unit if it is wrong, then accept it with `skillunit review`';
const sync: SyncResult = {
  ok: false,
  skill,
  lock: { path: '/repo/skillunit.lock', found: true },
  units: [
    { id: 'retry-idempotent-only', file: 'features/retries.md', line: 20, state: 'in-sync', sources: [{ source: 'src/retry.ts', state: 'in-sync', locked: '41d0c3e2b7a955c0', current: '41d0c3e2b7a955c0' }] },
    { id: 'pick-a-client', file: 'SKILL.md', line: 12, state: 'stale', sources: [{ source: 'src/create.ts#create', state: 'stale', locked: '9f2c1a7b04d1e6aa', current: '0e3adc4f5a6b7c8d' }] },
    { id: 'await-every-request', file: 'SKILL.md', line: 30, state: 'new', sources: [{ source: 'src/request.ts', state: 'new', current: '1234567890abcdef' }] },
  ],
  orphans: [{ unit: 'old-rule' }],
  problems: [
    { file: 'SKILL.md', line: 12, unit: 'pick-a-client', severity: 'error', rule: 'sync', message: `\`src/create.ts#create\` changed since the unit was last reviewed; ${REVIEW}` },
    { file: 'SKILL.md', line: 30, unit: 'await-every-request', severity: 'error', rule: 'sync', message: `this unit is not in skillunit.lock; ${REVIEW}` },
    {
      file: '../../skillunit.lock',
      line: 5,
      unit: 'old-rule',
      severity: 'warning',
      rule: 'sync',
      message: 'skillunit.lock has an entry for `old-rule`, and no unit with a `Source` has that id; `skillunit review --prune` drops it',
    },
  ],
  summary: { units: 4, withSource: 3, inSync: 1, stale: 1, new: 1, orphans: 1 },
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

const full: CheckReport = buildReport('check', { lint, sync, test });
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
      sync: { ...sync, ok: true, problems: [], orphans: [], units: [{ ...sync.units[0]! }], summary: { ...sync.summary, withSource: 1, stale: 0, new: 0, orphans: 0 } },
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
    expect(json).toMatchObject({ schema: 3, command: 'check', ok: false });
    expect(json.test.specs[0].verdicts[1].borderline).toBe(true);
  });

  it('github: escapes the characters workflow commands use', () => {
    const odd = buildReport('lint', {
      lint: { ...lint, problems: [{ file: 'a,b:c.md', line: 1, severity: 'error', rule: 'index', message: '100% broken\nsecond line' }] },
    });
    expect(render(odd, 'github', options).split('\n')[0]).toBe('::error file=skills/demo/a%2Cb%3Ac.md,line=1,title=SkillUnit lint::100%25 broken%0Asecond line');
  });
});
