// The file `checking.md` of SkillUnit's own skill: its `setup()`, then its units in the order the file shows them.
import { spawnSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect } from 'vitest';
import { COMMON_OPTIONS, EXIT, OPTIONS } from '../commands.js';
import { CONFIG_FILE } from '../config.js';
import { defaultBase, Git } from '../git.js';
import { REPORT_SCHEMA, REPORTERS } from '../report/types.js';
import { changedSelection, changedSkillFiles } from '../test/changed.js';
import { runAll } from '../test/runner.js';
import { and, BIN, cleanUp, cli, code, collected, command, modelModule, option, project, question, report, runner, skillProject, stub } from './helpers.js';

afterEach(cleanUp);

setup('checking', {
  file: 'checking.md',
  title: 'SkillUnit — building and checking',
  when: 'Build the skill, check it, or read what a check reports',
  description: 'What each command checks, the options it takes, and what it reports.',
});

const INDEX = { file: 'SKILL.md', title: 'Demo', description: 'A skill to try SkillUnit on.', frontmatter: { name: 'demo', description: 'Use it to try SkillUnit.' } };
const ASK = { scenario: 'A request failed.', question: 'What does the agent do?', options: { wait: 'Wait, then send it again', now: 'Send it again at once' }, expect: 'wait' };
const write = option('proof', '--write');
const dryRun = option('check', '--dry-run');

/** A project with `SKILL.md` and `retries.md`, a unit with a question in each, built. */
async function built(settings?: string) {
  const p = await project(
    (r) => {
      r.setup('demo', INDEX);
      r.unit('read-the-docs', { when: 'a request is new.', do: 'read the docs first.', ask: { ...ASK, id: 'read-first' } });
      r.setup('retries', { file: 'retries.md', title: 'Retries', when: 'Retry a request that failed', description: 'How requests are retried.' });
      r.unit('wait-before-retry', { when: 'a request is sent again.', do: 'wait before each new attempt.', ask: ASK });
    },
    settings ? { settings } : {},
  );
  p.proof({ write: true });
  return p;
}

/** A line of the built skill edited by hand. */
const edit = (p: Awaited<ReturnType<typeof built>>) => p.write('skill/retries.md', p.read('skill/retries.md').replace('wait before each', 'wait a little before each'));

describe('checking.md', () => {
  unit('options', { when: `an agent runs a command of \`${BIN}\` with options.`, values: { usage: EXIT.usage } }, async (u) => {
    const p = await built();
    const values: Record<string, string> = {
      '--config': CONFIG_FILE,
      '--skill': 'skill',
      '--reporter': 'json',
      '--base': 'main',
      '--provider': 'typesafe',
      '--model': 'any',
      '--choice': '0.5',
      '--yes': '0.7',
      '--no': '0.3',
      '--margin': '0.1',
    };
    const commands = Object.keys(OPTIONS) as (keyof typeof OPTIONS)[];
    const runs = commands.flatMap((c) => [...COMMON_OPTIONS, ...OPTIONS[c]].map(async (flag) => [c, flag, await cli(p.root, [c, flag, ...(values[flag] ? [values[flag]] : []), ...(c === 'proof' ? [] : [dryRun])])] as const));
    for (const [c, flag, ran] of await Promise.all(runs)) expect(ran.stderr, `${c} ${flag}`).not.toContain('does not take');
    const refused = await cli(p.root, [command('test'), write]);
    expect(refused.status).toBe(EXIT.usage);
    expect(refused.stderr).toContain(`test does not take ${write}`);
    const groups = new Map<string, string[]>();
    for (const c of commands) groups.set(OPTIONS[c].join(' '), [...(groups.get(OPTIONS[c].join(' ')) ?? []), c]);
    const takes = [...groups.values()].map((same) => `${and(code(same))} ${same.length > 1 ? 'take' : 'takes'} ${and(code(OPTIONS[same[0] as keyof typeof OPTIONS]))}.`);
    u.value(`${takes.join(' ')} Each of them also takes ${and(code(COMMON_OPTIONS))}. Any other option is refused, with exit code ${EXIT.usage}.`);
  });

  unit(
    'proof-compares',
    {
      when: `\`${command('proof')}\` runs.`,
      value: `without \`${write}\`, \`${command('proof')}\` compares the build with the skill folder, and reports each block of a file that differs and each file the folder lacks. With \`${write}\`, it writes them to the folder instead.`,
    },
    async () => {
      const p = await project((r) => {
        r.setup('demo', INDEX);
        r.unit('wait-before-retry', { when: 'a request is sent again.', do: 'wait before each new attempt.' });
      });
      const missing = p.proof();
      expect(missing.files).toEqual([{ file: 'SKILL.md', state: 'missing' }]);
      expect(missing.problems.map((x) => x.message)).toEqual([expect.stringContaining('the skill folder has no `SKILL.md`')]);
      expect(p.proof({ write: true }).files).toEqual([{ file: 'SKILL.md', state: 'written' }]);
      p.write('skill/SKILL.md', p.read('skill/SKILL.md').replace('# Demo', '# A demo').replace('wait before', 'wait just before'));
      const differs = p.proof();
      expect(differs.files).toEqual([{ file: 'SKILL.md', state: 'differs' }]);
      expect(differs.problems).toHaveLength(2);
      expect(p.proof({ write: true }).files).toEqual([{ file: 'SKILL.md', state: 'written' }]);
      expect(p.proof().ok).toBe(true);
    },
  );

  unit(
    'stale-unit',
    {
      when: 'a test that declares a unit is skipped or deleted.',
      value: `a unit the skill folder has and no test declares is reported: its test was skipped or deleted, or did not run. \`${write}\` takes it out of the skill after a run that passed.`,
    },
    async () => {
      const p = await built();
      rmSync(join(p.root, 'tmp/skill-units/3-wait-before-retry.json'));
      const stale = p.proof();
      expect(stale.problems).toEqual([expect.objectContaining({ file: 'retries.md', unit: 'wait-before-retry', message: expect.stringContaining('no test declares it: its test was skipped or deleted, or did not run') })]);
      p.proof({ write: true });
      expect(p.read('skill/retries.md')).not.toContain('wait-before-retry');
    },
  );

  unit('failed-run', { when: '`proof.run` fails, and the run left no record of a unit, a file or a row of the index that the skill has.' }, async (u) => {
    const p = await built();
    // The run gives back the records of `SKILL.md` only, as when the test file of `retries.md` fails to load, and fails.
    for (const name of ['0-demo.json', '1-read-the-docs.json']) p.write(`saved/${name}`, p.read(`tmp/skill-units/${name}`));
    p.write('restore.mjs', "import { copyFileSync } from 'node:fs';\nfor (const name of ['0-demo.json', '1-read-the-docs.json']) copyFileSync(`saved/${name}`, `tmp/skill-units/${name}`);\nprocess.exit(1);\n");
    p.write(CONFIG_FILE, 'skill: ./skill\nproof:\n  run: "node restore.mjs"\n');
    const before = [p.read('skill/SKILL.md'), p.read('skill/retries.md')];
    const failed = p.proof();
    expect(failed.problems[0]).toMatchObject({ run: true, message: expect.stringContaining('`proof.run` (`node restore.mjs`) exited with 1') });
    const rest = failed.problems.slice(1);
    expect(rest.map((x) => x.file).sort()).toEqual(['SKILL.md', 'retries.md']);
    for (const x of rest) expect(x.message).toMatch(/left no record of its `setup\(\)` while `proof\.run` failed: see the finding on the run, first in the report/);
    for (const x of rest) expect(x.message).not.toContain(`Run \`skillunit proof ${write}\``);
    const wrote = p.proof({ write: true });
    expect([p.read('skill/SKILL.md'), p.read('skill/retries.md')]).toEqual(before);
    expect(wrote.problems).toContainEqual(expect.objectContaining({ file: 'SKILL.md', severity: 'warning', message: expect.stringContaining(`\`${write}\` left \`SKILL.md\` as it is`) }));
    u.value(
      `the finding on the run comes first, with the end of its output. A unit, a file or a row of the index that the skill has and that run left no record of is reported as such, and points at the run; \`${write}\` takes none of them out until a run passes, and says which files it left as they are.`,
    );
  });

  unit('unfinished-test', { when: 'the test of a unit does not finish, because it times out or the run stops.' }, async (u) => {
    const p = await built();
    // A body the runner abandons: it never ends, so only the record written when it started is left.
    const r = runner();
    r.unit('wait-before-retry', { when: 'a request is sent again.', do: 'wait before each new attempt.' }, () => new Promise(() => {}));
    void r.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const left = r.records[0]!;
    expect(left.status).toBe('failed');
    const record = JSON.parse(p.read('tmp/skill-units/3-wait-before-retry.json'));
    p.write('tmp/skill-units/3-wait-before-retry.json', JSON.stringify({ ...left, file: record.file, line: record.line, setup: record.setup, order: record.order }));
    const before = p.read('skill/retries.md');
    const result = p.proof({ write: true });
    expect(result.units.find((x) => x.id === 'wait-before-retry')).toMatchObject({ state: 'failed' });
    expect(result.files).toContainEqual({ file: 'retries.md', state: 'broken' });
    expect(p.read('skill/retries.md')).toBe(before);
    const error = (left as { error: string }).error;
    u.value(
      `each test writes a failed record when it starts and replaces it when it ends, so a test that does not finish leaves a record whose error is "${error}". Its unit is reported as a failed test, at the line of the test, and \`${write}\` leaves its file as it is.`,
    );
  });

  unit(
    'extra-file',
    {
      when: 'the skill folder has a Markdown file of its own.',
      value: `a Markdown file in the skill folder that no \`${setup.name}()\` declares is reported, and \`${write}\` leaves it there.`,
    },
    async () => {
      const p = await built();
      p.write('skill/notes.md', '# Notes\n');
      expect(p.proof().problems.map((x) => [x.file, x.message])).toEqual([['notes.md', expect.stringContaining('no `setup()` declares `notes.md`')]]);
      p.proof({ write: true });
      expect(p.read('skill/notes.md')).toBe('# Notes\n');
    },
  );

  unit(
    'no-run',
    {
      when: `a command runs with \`${option('proof', '--no-run')}\`.`,
      value: `with \`${option('proof', '--no-run')}\`, a command runs no \`proof.run\`, and builds from the records the last run left in \`proof.units\`.`,
    },
    async () => {
      const p = await built();
      p.write(CONFIG_FILE, 'skill: ./skill\nproof:\n  run: "exit 1"\n');
      const result = p.proof({ noRun: true });
      expect(result.ok).toBe(true);
      expect(result.run).toEqual({ skipped: 'no-run' });
      expect(result.summary.units).toBe(2);
      expect(p.proof().ok).toBe(false);
    },
  );

  unit(
    'dry-run',
    {
      when: `\`${command('test')}\` or \`${command('check')}\` runs with \`${dryRun}\`.`,
      value: `with \`${dryRun}\`, nothing is sent to the decision model: the command checks that each question can be asked, that its headings are in its file, and that each request fits the model's limits, and the report gives an estimate of each request's tokens.`,
    },
    async () => {
      const model = stub(() => new Error('nothing should be sent'));
      const config = skillProject();
      const ran = await runAll(config, model.model, collected(question('retry-get'), question('missing-heading', { sections: ['Timeouts'] })), { dryRun: true });
      expect(model.calls).toHaveLength(0);
      expect(ran.requests[0]).toMatchObject({ verdicts: [{ id: 'retry-get', answer: '(dry run)' }] });
      expect(ran.requests[0]!.estimatedTokens).toBeGreaterThan(0);
      expect(ran.requests[1]!.error).toContain('no heading "Timeouts"');
    },
  );

  unit(
    'skill-copy',
    {
      when: 'a command should read another folder than the skill of the settings, such as a copy.',
      value: `\`${option('check', '--skill')} <dir>\` makes a command read that folder instead of \`skill\` in the settings: \`${command('test')} ${option('check', '--skill')} <copy>\` asks the questions about the copy, and \`${command('proof')} ${option('check', '--skill')} <copy>\` compares the build with it.`,
    },
    async () => {
      const p = await built();
      cpSync(p.skill, join(p.root, 'copy'), { recursive: true });
      p.write('copy/retries.md', `${p.read('copy/retries.md')}\nA line only the copy has.\n`);
      expect(report(await cli(p.root, [command('proof'), '--json'])).ok).toBe(true);
      expect(report(await cli(p.root, [command('proof'), option('proof', '--skill'), 'copy', '--json'])).ok).toBe(false);
      const chars = async (...args: string[]) => report(await cli(p.root, [command('test'), dryRun, ...args, '--json'])).test!.requests.find((r) => r.file === 'retries.md')!.chars;
      expect(await chars(option('test', '--skill'), 'copy')).toBeGreaterThan(await chars());
    },
  );

  unit(
    'changed',
    {
      when: `a run should ask only about what a branch changed, with \`${option('check', '--changed')}\`.`,
      value: `\`${option('check', '--changed')}\` asks only the questions about the skill files, or their \`with\` files, that differ from the merge base of HEAD and \`${option('check', '--base')}\`, with uncommitted and untracked changes. Without \`${option('check', '--base')}\`, the base is the target branch of the pull request in GitHub Actions (\`GITHUB_BASE_REF\`), or else the default branch.`,
    },
    async () => {
      const p = await built();
      const git = (...args: string[]) => spawnSync('git', ['-c', 'user.email=skill@example.com', '-c', 'user.name=Skill', ...args], { cwd: p.root, encoding: 'utf8' });
      git('init', '-q');
      git('symbolic-ref', 'HEAD', 'refs/heads/main');
      git('add', '-A');
      git('commit', '-q', '-m', 'skill');
      git('checkout', '-q', '-b', 'feature');
      edit(p);
      p.write('skill/new.md', '# New\n');
      const changed = changedSkillFiles(p.skill, 'main');
      expect(changed.files.sort()).toEqual(['new.md', 'retries.md']);
      const select = changedSelection(changed);
      expect([question('in-retries', { file: 'retries.md' }), question('in-index', { file: 'SKILL.md' }), question('with-retries', { file: 'SKILL.md', withFiles: ['retries.md'] })].map(select)).toEqual([true, false, true]);
      const repo = new Git(p.root);
      expect(defaultBase(repo)).toBe('main');
      git('update-ref', 'refs/remotes/origin/develop', 'HEAD');
      const before = process.env.GITHUB_BASE_REF;
      process.env.GITHUB_BASE_REF = 'develop';
      try {
        expect(defaultBase(repo)).toBe('origin/develop');
      } finally {
        if (before === undefined) delete process.env.GITHUB_BASE_REF;
        else process.env.GITHUB_BASE_REF = before;
      }
    },
  );

  unit('exit-codes', { when: `a script or CI reads what \`${BIN}\` exited with.`, values: { ...EXIT } }, async (u) => {
    const p = await built(`skill: ./skill\nmodel: ./model.mjs\nproof: {}\n`);
    const answer = (probabilities: Record<string, number>) => p.write('model.mjs', modelModule(probabilities));
    answer({ wait: 0.55, now: 0.45, none: 0 });
    const borderline = await cli(p.root, [command('check'), '--json']);
    expect(report(borderline).test?.summary.borderline).toBe(2);
    expect(borderline.status).toBe(EXIT.passed);
    answer({ wait: 0.2, now: 0.8, none: 0 });
    expect((await cli(p.root, [command('check')])).status).toBe(EXIT.failed);
    answer({ wait: 0.9, now: 0.1, none: 0 });
    expect((await cli(p.root, [command('check')])).status).toBe(EXIT.passed);
    edit(p);
    expect((await cli(p.root, [command('proof')])).status).toBe(EXIT.failed);
    expect((await cli(p.root, [command('proof'), '--nothing'])).status).toBe(EXIT.usage);
    expect((await cli(p.root, [command('proof'), option('proof', '--skill'), 'nowhere'])).status).toBe(EXIT.usage);
    p.write(CONFIG_FILE, 'skill: ./skill\nproof: {}\n');
    expect((await cli(p.root, [command('check')])).status).toBe(EXIT.usage);
    p.write(CONFIG_FILE, 'skil: ./skill\n');
    expect((await cli(p.root, [command('proof')])).status).toBe(EXIT.usage);
    // With no `proof`, nothing builds the skill or declares its questions.
    p.write(CONFIG_FILE, 'skill: ./skill\n');
    const commands = [command('proof'), command('test'), command('check')];
    const noProof = await Promise.all(commands.map((c) => cli(p.root, c === command('proof') ? [c] : [c, dryRun])));
    expect(noProof.map((r) => r.status)).toEqual(commands.map(() => EXIT.usage));
    for (const r of noProof) expect(r.stderr).toContain('no `proof` in');
    u.value(
      `\`${BIN}\` exits with ${EXIT.passed} when every check passed, borderline verdicts included; with ${EXIT.failed} when a check failed; and with ${EXIT.usage} when the command itself was wrong: an option it does not take, a folder that is not there, no API key, or settings that are not valid. Settings with no \`proof\` give ${EXIT.usage} to ${and(code(commands))}: the skill and its questions both come from the records of \`proof.run\`.`,
    );
  });

  unit('reporters', { when: `a person, a script or CI reads what \`${BIN}\` reports.`, values: { schema: REPORT_SCHEMA } }, async (u) => {
    const p = await built();
    edit(p);
    const out = async (...args: string[]) => (await cli(p.root, [command('proof'), ...args])).stdout;
    const reporter = option('proof', '--reporter');
    const json = JSON.parse(await out(option('proof', '--json')));
    expect(json).toMatchObject({ schema: REPORT_SCHEMA, command: 'proof', ok: false });
    expect(JSON.parse(await out(reporter, 'json'))).toEqual(json);
    expect(await out(reporter, 'github')).toMatch(/^::error file=.*retries\.md,line=\d+,/m);
    expect(await out(reporter, 'junit')).toMatch(/^<\?xml/);
    expect(await out()).toBe(await out(reporter, 'table'));
    expect(REPORTERS[0]).toBe('table');
    u.value(
      `\`${reporter}\` takes ${and(code(REPORTERS))}; \`${REPORTERS[0]}\` is the default. \`${option('proof', '--json')}\` is \`${reporter} json\`: the whole report as JSON, with its \`schema\`, ${REPORT_SCHEMA}. \`github\` prints an annotation at the line of each finding, which GitHub Actions shows on the pull request.`,
    );
  });

  unit(
    'origin',
    {
      when: 'the proof reports a line of the skill.',
      value: 'each finding about a line of the skill names the test that declares it: in `origin`, in the JSON report, and after the finding in the table.',
    },
    async () => {
      const p = await built();
      edit(p);
      const ran = report(await cli(p.root, [command('proof'), option('proof', '--json')]));
      const problem = ran.proof?.configured ? ran.proof.problems[0] : undefined;
      const unitLine = JSON.parse(p.read('tmp/skill-units/3-wait-before-retry.json')).line;
      expect(problem?.origin).toEqual({ kind: 'test', file: '../skill.test.ts', line: unitLine, unit: 'wait-before-retry' });
      expect((await cli(p.root, [command('proof')])).stdout).toContain(`skill.test.ts:${unitLine}`);
    },
  );

  // A gap: which of the code and the sentence moved is the user's to know; `failed-body` is what
  // SkillUnit does with the failed test.
  unit('when-a-test-fails', {
    when: 'the test of a unit fails after a change to the code.',
    do: `find out which moved. When the code changed on purpose, change the sentence and the body to say what the code does now, then \`${command('proof')} ${write}\`; when it did not, fix the code. Never change the body only so that it passes.`,
    evenWhen: 'the fix in the body is one line: a body that passes and a sentence that is false is the drift the skill is built to catch.',
    ask: {
      id: 'the-code-moved',
      scenario: 'A change to the code makes the test of a unit fail: its body expects a wait of 300 ms, and the code now waits 500 ms. The user says the change to 500 ms is on purpose, and asks for the test to pass.',
      question: 'What does the agent change?',
      options: {
        unit: `The body and the sentence of the unit, so both say 500 ms, then \`${command('proof')} ${write}\``,
        body: 'The number the body expects, so the test passes',
        code: 'The code, back to 300 ms',
      },
      expect: 'unit',
    },
  });
});
