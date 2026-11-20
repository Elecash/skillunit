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
    commandChecked: 0,
    unchecked: { sh: 2 },
    noCheck: 1,
    notConfigured: 0,
    wrongCode: { checked: 2, unchecked: 0 },
  },
};

const sync: SyncResult = {
  ok: false,
  skill,
  base: { ref: 'origin/main', commit: '0e3adc4f00000000000000000000000000000000' },
  changed: ['skills/demo/features/retries.md', 'src/retry.ts', 'src/create.ts'],
  skillFiles: ['features/retries.md'],
  units: [
    { id: 'retry-idempotent-only', file: 'features/retries.md', line: 20, sources: ['src/retry.ts'], status: 'edited' },
    { id: 'pick-a-client', file: 'SKILL.md', line: 12, sources: ['src/create.ts'], status: 'to-review' },
  ],
  problems: [
    {
      file: 'SKILL.md',
      line: 12,
      unit: 'pick-a-client',
      severity: 'error',
      rule: 'sync',
      message: '`src/create.ts` changed since 0e3adc4 and this unit did not; review it, then edit it or add `Skill-reviewed: pick-a-client` to a commit message',
    },
  ],
  summary: { units: 3, pointing: 2, edited: 1, marked: 0, toReview: 1 },
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
      sync: { ...sync, ok: true, problems: [], units: [{ ...sync.units[0]! }], summary: { ...sync.summary, pointing: 1, toReview: 0 } },
      test: { ...test, ok: true, specs: [{ ...test.specs[0]!, verdicts: test.specs[0]!.verdicts.slice(0, 2) }], summary: { ...test.summary, tests: 2, passed: 2, borderline: 1, skipped: 0 } },
    });
    expect(clean.ok).toBe(true);
    expect(render(clean, 'table', options)).toMatchSnapshot();
    expect(render(clean, 'github', options)).toMatchSnapshot();
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

  it('json: the report as it is, with the schema', () => {
    const json = JSON.parse(render(full, 'json', options));
    expect(json).toMatchObject({ schema: 2, command: 'check', ok: false });
    expect(json.test.specs[0].verdicts[1].borderline).toBe(true);
  });

  it('github: escapes the characters workflow commands use', () => {
    const odd = buildReport('lint', {
      lint: { ...lint, problems: [{ file: 'a,b:c.md', line: 1, severity: 'error', rule: 'index', message: '100% broken\nsecond line' }] },
    });
    expect(render(odd, 'github', options).split('\n')[0]).toBe('::error file=skills/demo/a%2Cb%3Ac.md,line=1,title=skillunit lint::100%25 broken%0Asecond line');
  });
});
