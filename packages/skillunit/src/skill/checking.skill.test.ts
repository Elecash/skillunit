// The file `checking.md` of SkillUnit's own skill: its `setup()`, then its units in the order the file shows them.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { and, code, or, setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect } from 'vitest';
import { COMMON_OPTIONS, EXIT, OPTIONS } from '../commands.js';
import { CONFIG_FILE } from '../config.js';
import { defaultBase, Git } from '../git.js';
import { RUN_LINES } from '../proof/layer.js';
import { REPORT_SCHEMA, REPORTERS } from '../report/types.js';
import { changedSelection, changedSkillFiles } from '../test/changed.js';
import { runAll } from '../test/runner.js';
import { BIN, cleanUp, cli, collected, command, modelModule, option, project, question, report, runner, skillProject, stub, TEST_FILE } from './helpers.js';

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
    const wrong: string[] = [];
    for (const [c, flag, ran] of await Promise.all(runs)) if (ran.stderr.includes('does not take')) wrong.push(`\`${c} ${flag}\``);
    const refused = await cli(p.root, [command('test'), write]);
    expect(refused.status, 'the command ends').not.toBeNull();
    const refuses = refused.status === EXIT.usage && refused.stderr.includes(`test does not take ${write}`);
    const groups = new Map<string, string[]>();
    for (const c of commands) groups.set(OPTIONS[c].join(' '), [...(groups.get(OPTIONS[c].join(' ')) ?? []), c]);
    const takes = [...groups.values()].map((same) => `${and(code(same))} ${same.length > 1 ? 'take' : 'takes'} ${and(code(OPTIONS[same[0] as keyof typeof OPTIONS]))}.`);
    u.value(
      `${takes.join(' ')} Each of them also takes ${and(code(COMMON_OPTIONS))}${wrong.length ? `, though ${and(wrong)} ${wrong.length > 1 ? 'are' : 'is'} refused` : ''}. ${refuses ? `Any other option is refused, with exit code ${EXIT.usage}` : 'An option a command does not take is not refused'}.`,
    );
  });

  unit(
    'proof-compares',
    {
      when: `\`${command('proof')}\` runs.`,
    },
    async (u) => {
      const p = await project((r) => {
        r.setup('demo', INDEX);
        r.unit('wait-before-retry', { when: 'a request is sent again.', do: 'wait before each new attempt.' });
      });
      const missing = p.proof();
      const lacks = missing.files[0]?.state === 'missing' && missing.problems.some((x) => x.message.includes('the skill folder has no `SKILL.md`'));
      p.proof({ write: true });
      const wroteMissing = existsSync(join(p.skill, 'SKILL.md'));
      expect(wroteMissing || !lacks, 'the file the folder lacks is there after a write, or was never reported').toBe(true);
      // Two blocks edited by hand, apart: the title and a line of the unit.
      p.write('skill/SKILL.md', p.read('skill/SKILL.md').replace('# Demo', '# A demo').replace('wait before', 'wait just before'));
      const differs = p.proof();
      const blocks = differs.problems.length === 2 ? 'each block of a file that differs' : 'a file that differs, not block by block';
      p.proof({ write: true });
      const wrote = p.proof().ok;
      u.value(
        `without \`${write}\`, \`${command('proof')}\` compares the build with the skill folder, and reports ${blocks}${lacks ? ' and each file the folder lacks' : ''}. With \`${write}\`, it ${wrote && wroteMissing ? 'writes them to the folder instead' : 'does not write them all'}.`,
      );
    },
  );

  unit(
    'stale-unit',
    {
      when: 'a test that declares a unit is skipped or deleted.',
    },
    async (u) => {
      const p = await built();
      expect(p.read('skill/retries.md')).toContain('wait-before-retry');
      rmSync(join(p.root, 'tmp/skill-units/3-wait-before-retry.json'));
      const stale = p.proof();
      const named = stale.problems.some((x) => x.unit === 'wait-before-retry' && x.message.includes('no test declares it: its test was skipped or deleted, or did not run'));
      // An error elsewhere, as a test left out by \`.only\` leaves: a region of the test file that belongs to no unit.
      p.write(TEST_FILE, `// ${'#'}region skill:nobody\nx;\n// ${'#'}endregion\n`);
      p.proof({ write: true });
      const held = p.read('skill/retries.md').includes('wait-before-retry');
      p.write(TEST_FILE, '');
      p.proof({ write: true });
      const out = !p.read('skill/retries.md').includes('wait-before-retry');
      u.value(
        `a unit the skill folder has and no test declares is ${named ? 'reported: its test was skipped or deleted, or did not run' : 'not reported'}. \`${write}\` ${out ? 'takes it out of the skill' : 'leaves it in the skill'}${held ? ' only when the proof has no other error, such as a failed run' : ', whatever else the proof reports'}.`,
      );
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
    expect(failed.problems.length, 'the proof reports something').toBeGreaterThan(0);
    const first = failed.problems[0]!.run === true && failed.problems[0]!.message.includes('`proof.run` (`node restore.mjs`) exited with 1');
    const rest = failed.problems.filter((x) => !x.run);
    const pointed = rest.map((x) => x.file).sort().join() === 'SKILL.md,retries.md' && rest.every((x) => /left no record of its `setup\(\)` while `proof\.run` failed: see the finding on the run, first in the report/.test(x.message) && !x.message.includes(`Run \`skillunit proof ${write}\``));
    const wrote = p.proof({ write: true });
    const kept = [p.read('skill/SKILL.md'), p.read('skill/retries.md')].join() === before.join();
    const says = wrote.problems.some((x) => x.file === 'SKILL.md' && x.severity === 'warning' && x.message.includes(`\`${write}\` left \`SKILL.md\` as it is`));
    u.value(
      `${first ? 'the finding on the run comes first, with the end of its output' : 'the run is not the first finding'}. A unit, a file or a row of the index that the skill has and that run left no record of is ${pointed ? 'reported as such, and points at the run' : 'not reported as one that points at the run'}; \`${write}\` ${kept ? `takes none of them out until a run passes and the proof has no error${says ? ', and says which files it left as they are' : ''}` : 'takes them out all the same'}.`,
    );
  });

  unit('run-left-no-record', { when: '`proof.run` fails before any test writes a record, as when it type-checks the tests first and finds an error.', values: { lines: RUN_LINES } }, async (u) => {
    const p = await built();
    const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
    // The tests would give back the records of the build; the type-check before them fails first.
    for (const name of ['0-demo.json', '1-read-the-docs.json', '2-retries.json', '3-wait-before-retry.json']) p.write(`saved/${name}`, p.read(`tmp/skill-units/${name}`));
    p.write('tests.mjs', "import { cpSync } from 'node:fs';\ncpSync('saved', 'tmp/skill-units', { recursive: true });\n");
    p.write('tsconfig.json', '{ "compilerOptions": { "strict": true, "noEmit": true, "types": [] }, "include": ["a.ts"] }\n');
    p.write('a.ts', "export const retries: number = 'two';\n");
    p.write(CONFIG_FILE, `skill: ./skill\nproof:\n  run: "node ${JSON.stringify(tsc).slice(1, -1)} --noEmit --pretty false && node tests.mjs"\n`);
    const before = [p.read('skill/SKILL.md'), p.read('skill/retries.md')];
    const failed = p.proof({ write: true });
    expect(failed.ok, 'the type error fails the proof').toBe(false);
    const only = failed.problems.length === 1 && failed.problems[0]!.run === true;
    const start = failed.problems[0]!.message.includes('left no record in `tmp/skill-units`: it failed before any test wrote one. Its output:\na.ts(1,14): error TS2322');
    const nothing = failed.files.length === 0;
    const kept = [p.read('skill/SKILL.md'), p.read('skill/retries.md')].join() === before.join();
    p.write('a.ts', 'export const retries: number = 2;\n');
    expect(p.proof().ok, 'with no type error, the proof passes').toBe(true);
    u.value(
      `the finding on the run is ${only ? 'the only one' : 'not the only one'}. It shows ${start ? "the start of the run's output" : "another part of the run's output"}, up to ${RUN_LINES} lines, where a type-check prints its errors; proof ${nothing ? 'builds and compares nothing' : 'still compares the skill folder'}, and \`${write}\` ${kept ? 'writes nothing' : 'writes the skill all the same'}.`,
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
    expect(left, 'a record is there before the test ends').toBeDefined();
    const record = JSON.parse(p.read('tmp/skill-units/3-wait-before-retry.json'));
    p.write('tmp/skill-units/3-wait-before-retry.json', JSON.stringify({ ...left, file: record.file, line: record.line, setup: record.setup, order: record.order }));
    const before = p.read('skill/retries.md');
    const result = p.proof({ write: true });
    const failedUnit = result.units.find((x) => x.id === 'wait-before-retry')?.state === 'failed' && result.files.some((f) => f.file === 'retries.md' && f.state === 'broken');
    const kept = p.read('skill/retries.md') === before;
    const error = (left as { error?: string }).error;
    u.value(
      left.status === 'failed'
        ? `each test writes a failed record when it starts and replaces it when it ends, so a test that does not finish leaves a record whose error is "${error}". Its unit is ${failedUnit ? 'reported as a failed test, at the line of the test' : 'not reported as a failed test'}, and \`${write}\` ${kept ? 'leaves its file as it is' : 'writes its file all the same'}.`
        : `a test writes no failed record when it starts, so a test that does not finish leaves a record that says it ${left.status}, and \`${write}\` ${kept ? 'leaves its file as it is' : 'writes its file all the same'}.`,
    );
  });

  unit(
    'extra-file',
    {
      when: 'the skill folder has a Markdown file of its own.',
    },
    async (u) => {
      const p = await built();
      p.write('skill/notes.md', '# Notes\n');
      const found = p.proof().problems;
      expect(found.every((x) => x.file === 'notes.md'), 'the one file is all it can report').toBe(true);
      const reported = found.some((x) => x.message.includes('no `setup()` declares `notes.md`'));
      p.proof({ write: true });
      const left = existsSync(join(p.skill, 'notes.md')) && p.read('skill/notes.md') === '# Notes\n';
      u.value(`a Markdown file in the skill folder that no \`${setup.name}()\` declares is ${reported ? 'reported' : 'not reported'}, and \`${write}\` ${left ? 'leaves it there' : 'does not leave it as it was'}.`);
    },
  );

  unit(
    'no-run',
    {
      when: `a command runs with \`${option('proof', '--no-run')}\`.`,
    },
    async (u) => {
      const p = await built();
      // A run that fails and would empty the records: with `--no-run`, neither happens.
      p.write(CONFIG_FILE, 'skill: ./skill\nproof:\n  run: "exit 1"\n');
      const result = p.proof({ noRun: true });
      expect(p.proof().ok, 'the run fails when it runs').toBe(false);
      const ran = !('skipped' in result.run);
      const fromRecords = result.ok && result.summary.units === 2;
      u.value(
        `with \`${option('proof', '--no-run')}\`, a command ${ran ? 'still runs' : 'runs no'} \`proof.run\`, and ${fromRecords ? 'builds from the records the last run left' : 'does not build from the records the last run left'} in \`proof.units\`.`,
      );
    },
  );

  unit(
    'dry-run',
    {
      when: `\`${command('test')}\` or \`${command('check')}\` runs with \`${dryRun}\`.`,
    },
    async (u) => {
      const model = stub(() => ({}));
      const config = skillProject();
      const ran = await runAll(config, model.model, collected(question('retry-get'), question('missing-heading', { sections: ['Timeouts'] })), { dryRun: true });
      expect(ran.requests).toHaveLength(2);
      const sent = model.calls.length > 0;
      const headings = ran.requests[1]!.error?.includes('no heading "Timeouts"') === true;
      const estimate = (ran.requests[0]!.estimatedTokens ?? 0) > 0;
      u.value(
        `with \`${dryRun}\`, ${sent ? 'the questions are still sent to the decision model' : 'nothing is sent to the decision model'}: the command checks that each question can be asked, ${headings ? 'that its headings are in its file' : 'but not that its headings are in its file'}, and that each request fits the model's limits${estimate ? ", and the report gives an estimate of each request's tokens" : ''}.`,
      );
    },
  );

  unit(
    'skill-copy',
    {
      when: 'a command should read another folder than the skill of the settings, such as a copy.',
    },
    async (u) => {
      const p = await built();
      cpSync(p.skill, join(p.root, 'copy'), { recursive: true });
      p.write('copy/retries.md', `${p.read('copy/retries.md')}\nA line only the copy has.\n`);
      expect(report(await cli(p.root, [command('proof'), '--json'])).ok).toBe(true);
      const compares = !report(await cli(p.root, [command('proof'), option('proof', '--skill'), 'copy', '--json'])).ok;
      const chars = async (...args: string[]) => report(await cli(p.root, [command('test'), dryRun, ...args, '--json'])).test!.requests.find((r) => r.file === 'retries.md')!.chars;
      const asks = (await chars(option('test', '--skill'), 'copy')) > (await chars());
      u.value(
        compares && asks
          ? `\`${option('check', '--skill')} <dir>\` makes a command read that folder instead of \`skill\` in the settings: \`${command('test')} ${option('check', '--skill')} <copy>\` asks the questions about the copy, and \`${command('proof')} ${option('check', '--skill')} <copy>\` compares the build with it.`
          : `\`${option('check', '--skill')} <dir>\` does not make every command read that folder: \`${command('test')}\` ${asks ? 'asks about the copy' : 'still asks about the skill of the settings'}, and \`${command('proof')}\` ${compares ? 'compares the build with the copy' : 'still compares the build with the skill of the settings'}.`,
      );
    },
  );

  unit(
    'changed',
    {
      when: `a run should ask only about what a branch changed, with \`${option('check', '--changed')}\`.`,
    },
    async (u) => {
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
      expect(changed.files, 'the edit is a change').toContain('retries.md');
      const untracked = changed.files.includes('new.md');
      const select = changedSelection(changed);
      const [own, other, viaWith] = [question('in-retries', { file: 'retries.md' }), question('in-index', { file: 'SKILL.md' }), question('with-retries', { file: 'SKILL.md', withFiles: ['retries.md'] })].map(select);
      expect(own, 'a question about the changed file is asked').toBe(true);
      const repo = new Git(p.root);
      const fallback = defaultBase(repo);
      git('update-ref', 'refs/remotes/origin/develop', 'HEAD');
      const before = process.env.GITHUB_BASE_REF;
      process.env.GITHUB_BASE_REF = 'develop';
      let inActions: string;
      try {
        inActions = defaultBase(repo);
      } finally {
        if (before === undefined) delete process.env.GITHUB_BASE_REF;
        else process.env.GITHUB_BASE_REF = before;
      }
      u.value(
        `\`${option('check', '--changed')}\` asks only the questions about the skill files${viaWith ? ', or their `with` files,' : ''} that differ from the merge base of HEAD and \`${option('check', '--base')}\`, with uncommitted ${untracked ? 'and untracked changes' : 'changes, and not untracked files'}${other ? '; it asks about the other files too' : ''}. Without \`${option('check', '--base')}\`, the base is ${inActions === 'origin/develop' ? 'the target branch of the pull request in GitHub Actions (`GITHUB_BASE_REF`), or else ' : ''}${fallback === 'main' ? 'the default branch' : `\`${fallback}\``}.`,
      );
    },
  );

  unit('exit-codes', { when: `a script or CI reads what \`${BIN}\` exited with.`, values: { ...EXIT } }, async (u) => {
    const p = await built(`skill: ./skill\nmodel: ./model.mjs\nproof: {}\n`);
    const answer = (probabilities: Record<string, number>) => p.write('model.mjs', modelModule(probabilities));
    answer({ wait: 0.55, now: 0.45, none: 0 });
    const borderline = await cli(p.root, [command('check'), '--json']);
    // Both verdicts near the threshold, when `check` asks and marks them.
    const nearBoth = report(borderline).test?.summary.borderline === 2;
    answer({ wait: 0.2, now: 0.8, none: 0 });
    const failedTest = (await cli(p.root, [command('check')])).status;
    answer({ wait: 0.9, now: 0.1, none: 0 });
    const passed = (await cli(p.root, [command('check')])).status;
    edit(p);
    const failedProof = (await cli(p.root, [command('proof')])).status;
    const wrong: [string, number | null][] = [
      ['an option it does not take', (await cli(p.root, [command('proof'), '--nothing'])).status],
      ['a folder that is not there', (await cli(p.root, [command('proof'), option('proof', '--skill'), 'nowhere'])).status],
    ];
    p.write(CONFIG_FILE, 'skill: ./skill\nproof: {}\n');
    wrong.push(['no API key', (await cli(p.root, [command('check')])).status]);
    p.write(CONFIG_FILE, 'skil: ./skill\n');
    wrong.push(['settings that are not valid', (await cli(p.root, [command('proof')])).status]);
    // With no `proof`, nothing builds the skill or declares its questions.
    p.write(CONFIG_FILE, 'skill: ./skill\n');
    const commands = [command('proof'), command('test'), command('check')];
    const noProof = await Promise.all(commands.map((c) => cli(p.root, c === command('proof') ? [c] : [c, dryRun])));
    for (const status of [borderline.status, failedTest, passed, failedProof, ...wrong.map(([, s]) => s), ...noProof.map((r) => r.status)]) expect(typeof status).toBe('number');
    const usage = wrong.filter(([, s]) => s === EXIT.usage).map(([what]) => what);
    const other = wrong.filter(([, s]) => s !== EXIT.usage).map(([what, s]) => `${what} exits with ${s}`);
    const refused = commands.filter((_, i) => noProof[i]!.status === EXIT.usage && noProof[i]!.stderr.includes('no `proof` in'));
    const failedWith = failedTest === failedProof ? `with ${failedTest} when a check failed` : `with ${failedTest} when a question failed and ${failedProof} when the proof did`;
    u.value(
      `\`${BIN}\` exits with ${passed} when every check passed, ${nearBoth ? `borderline verdicts ${borderline.status === passed ? 'included' : `excepted: a borderline pass exits with ${borderline.status}`}` : 'borderline verdicts aside'}; ${failedWith}; and with ${EXIT.usage} when the command itself was wrong: ${or(usage)}${other.length ? ` (${and(other)})` : ''}. Settings with no \`proof\` give ${EXIT.usage} to ${and(code(refused))}${refused.length < commands.length ? `, and not to ${and(code(commands.filter((c) => !refused.includes(c))))}` : ''}: the skill and its questions both come from the records of \`proof.run\`.`,
    );
  });

  unit(
    'advisory',
    {
      when: `CI asks the questions, and a question that fails should not block the merge.`,
      values: { ...EXIT },
    },
    async (u) => {
      const p = await built(`skill: ./skill\nmodel: ./model.mjs\nproof: {}\n`);
      const advisory = option('check', '--advisory');
      // Every question fails.
      p.write('model.mjs', modelModule({ wait: 0.2, now: 0.8, none: 0 }));
      const plain = await cli(p.root, [command('check')]);
      const checked = await cli(p.root, [command('check'), advisory]);
      const tested = await cli(p.root, [command('test'), option('test', '--advisory')]);
      const json = report(await cli(p.root, [command('check'), advisory, '--json']));
      const github = (await cli(p.root, [command('check'), advisory, option('check', '--reporter'), 'github'])).stdout;
      expect(json.test?.summary.passed, 'every question fails').toBe(0);
      const statusLine = checked.stdout.trim().split('\n').at(-1) ?? '';
      const warns = /^::warning .*title=SkillUnit test%3A wait-before-retry::/m.test(github) && !/^::error .*title=SkillUnit test%3A/m.test(github);
      // A provider that answers with an error is no verdict; nor is a proof that fails.
      p.write('model.mjs', "export default { id: 'down', limits: { perQuestionTokens: 100000, perRequestTokens: 100000 }, async decide() { throw new Error('the provider is down'); } };\n");
      const down = await cli(p.root, [command('check'), advisory]);
      p.write('model.mjs', modelModule({ wait: 0.2, now: 0.8, none: 0 }));
      edit(p);
      const proofFails = await cli(p.root, [command('check'), advisory]);
      for (const ran of [plain, checked, tested, down, proofFails]) expect(typeof ran.status).toBe('number');
      u.value(
        `with \`${advisory}\`, a question that fails is reported as it is without it, and ${checked.status === plain.status ? 'still fails the run' : 'does not fail the run'}: \`${command('check')}\` exits with ${checked.status} when only questions failed (${plain.status} without the flag) and with ${proofFails.status} when the proof fails, and \`${command('test')}\` with ${tested.status}. What is not a verdict ${down.status === EXIT.passed ? 'does not fail it either' : 'still fails it'}: a provider that answers with an error exits with ${down.status}. ${statusLine.endsWith(', advisory') ? 'The status line ends with `, advisory`, so a green run is not read as questions that passed' : 'The status line does not say the run was advisory'}; ${warns ? 'the `github` reporter writes those failures as warnings' : 'the `github` reporter writes those failures as errors'}, and the JSON report ${json.test?.advisory === true ? 'has `advisory: true` in `test`' : 'does not say the run was advisory'}. It is a flag only, with no key in \`${CONFIG_FILE}\`, so it shows where CI calls the command.`,
      );
    },
  );

  unit('reporters', { when: `a person, a script or CI reads what \`${BIN}\` reports.`, values: { schema: REPORT_SCHEMA } }, async (u) => {
    const p = await built();
    edit(p);
    const out = async (...args: string[]) => (await cli(p.root, [command('proof'), ...args])).stdout;
    const reporter = option('proof', '--reporter');
    const json = JSON.parse(await out(option('proof', '--json')));
    expect(json).toMatchObject({ command: 'proof', ok: false });
    const same = JSON.stringify(JSON.parse(await out(reporter, 'json'))) === JSON.stringify(json);
    const github = await out(reporter, 'github');
    expect(github, 'an annotation for the edit').toMatch(/^::error file=.*retries\.md/m);
    const atLine = /^::error file=.*retries\.md,line=\d+,/m.test(github);
    expect(await out(reporter, 'junit')).toMatch(/^<\?xml/);
    const tableByDefault = (await out()) === (await out(reporter, 'table'));
    u.value(
      `\`${reporter}\` takes ${and(code(REPORTERS))}; ${tableByDefault ? '`table` is the default' : 'the default is not `table`'}. \`${option('proof', '--json')}\` ${same ? `is \`${reporter} json\`` : `is not quite \`${reporter} json\``}: the whole report as JSON, with its \`schema\`, ${json.schema}. \`github\` prints an annotation ${atLine ? 'at the line of each finding' : 'for each finding, with no line'}, which GitHub Actions shows on the pull request.`,
    );
  });

  unit(
    'origin',
    {
      when: 'the proof reports a line of the skill.',
    },
    async (u) => {
      const p = await built();
      edit(p);
      const ran = report(await cli(p.root, [command('proof'), option('proof', '--json')]));
      const problem = ran.proof?.configured ? ran.proof.problems[0] : undefined;
      expect(problem, 'the edit is reported').toBeDefined();
      const unitLine = JSON.parse(p.read('tmp/skill-units/3-wait-before-retry.json')).line;
      const json = JSON.stringify(problem?.origin) === JSON.stringify({ kind: 'test', file: '../skill.test.ts', line: unitLine, unit: 'wait-before-retry' });
      const table = (await cli(p.root, [command('proof')])).stdout.includes(`skill.test.ts:${unitLine}`);
      const where = [json ? 'in `origin`, in the JSON report' : '', table ? 'after the finding in the table' : ''].filter(Boolean);
      u.value(where.length ? `each finding about a line of the skill names the test that declares it: ${and(where)}.` : 'a finding about a line of the skill does not name the test that declares it.');
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
