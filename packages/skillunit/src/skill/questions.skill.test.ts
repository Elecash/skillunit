// The file `questions.md` of SkillUnit's own skill: its `setup()`, then its units in the order the file shows them.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ask, key, setup, unit, type UnitQuestion, type UnitSpec } from 'skillunit/vitest';
import { afterEach, describe, expect } from 'vitest';
import { DEFAULT_THRESHOLDS, type Thresholds } from '../config.js';
import { buildRequest, judge, read } from '../test/reader.js';
import { runAll } from '../test/runner.js';
import { checkQuestions, DEFAULT_SKILL_FILE, NONE, QUESTION_KEYS } from '../unit/contract.js';
import { and, cleanUp, cli, code, collected, command, option, project, question, report, runner, skillProject, stub } from './helpers.js';

afterEach(cleanUp);

setup('questions', {
  file: 'questions.md',
  title: 'SkillUnit — questions for the decision model',
  when: 'Add or fix a question for the decision model',
  description: 'How a test declares a question, what the model reads to answer it, and how its answer is judged.',
});

const q = key<UnitQuestion>;
const threshold = key<Thresholds>;
const { choice, yes, no, margin } = DEFAULT_THRESHOLDS;
/** A choice question that expects `wait`. */
const WAIT = { id: 'wait', scenarios: ['A request failed.'], question: 'What does the agent do?', options: { wait: null, now: null }, expect: 'wait' };

describe('questions.md', () => {
  unit('question-spec', { when: 'a test declares a question for the decision model.' }, async (u) => {
    const base = { scenario: 'A request failed.', question: 'What does the agent do?' };
    expect(checkQuestions('a', { ...base, options: { wait: 'Wait', now: 'Now' }, expect: NONE })[0]!.expect).toBe(NONE);
    expect(() => checkQuestions('a', { ...base, options: { wait: 'Wait', [NONE]: 'None' }, expect: 'wait' })).toThrow(`\`${NONE}\` is added to every question with options`);
    expect(() => checkQuestions('a', { ...base, expect: 'maybe' })).toThrow('`expect` must be `yes` or `no`');
    expect(() => checkQuestions('a', { ...base, expect: 'yes', hint: 'x' })).toThrow('unknown key `hint`');
    const sent = buildRequest('# Skill', [WAIT]).questions[0]!.options!.map((o) => o.id);
    expect(sent).toEqual(['wait', 'now', NONE]);
    const r = runner();
    r.ask('before-any-file', { ...base, expect: 'yes' });
    r.setup('retries', { file: 'retries.md', title: 'Retries', when: 'Retry a request', description: 'How requests are retried.' });
    r.ask('in-retries', { ...base, expect: 'yes' });
    r.ask('in-another', { ...base, expect: 'yes', file: 'timeouts.md' });
    r.unit('two-questions', { when: 'x.', do: 'y.', ask: [{ ...base, expect: 'yes' }, { ...base, expect: 'no' }] });
    expect((await r.run()).every((m) => m === 'ok')).toBe(true);
    const files = r.records.filter((x) => x.kind === 'question').map((x) => (x as { skillFile: string }).skillFile);
    expect(files).toEqual([DEFAULT_SKILL_FILE, 'retries.md', 'timeouts.md']);
    u.value(
      `a unit asks with \`${key<UnitSpec>('ask')}\` in its spec, one question or a list. \`${ask.name}(id, spec)\` asks about the prose of a built file: the one named in \`file\`, else the file of its \`${setup.name}()\`, else \`${DEFAULT_SKILL_FILE}\`. A question takes ${and(code(QUESTION_KEYS))}. With \`${q('options')}\`, SkillUnit adds \`${NONE}\`, which \`${q('expect')}\` may name and \`${q('options')}\` may not list; with no \`${q('options')}\`, \`${q('expect')}\` is \`yes\` or \`no\`.`,
    );
  });

  unit(
    'how-a-question-passes',
    {
      when: 'a verdict is read, or a threshold is chosen.',
      value: `a question with \`${q('options')}\` passes when the expected option has the highest probability, and that probability is at least \`${threshold('choice')}\`, ${choice} by default; a tie at the top never passes. A yes or no question passes when P(yes) is at least \`${threshold('yes')}\`, ${yes}, for \`yes\`, or at most \`${threshold('no')}\`, ${no}, for \`no\`.`,
      values: { choice, yes, no },
    },
    () => {
      const th = { ...DEFAULT_THRESHOLDS };
      const pass = (expect: string, probabilities: Record<string, number>, options: boolean) => judge({ ...WAIT, expect, ...(options ? {} : { options: undefined }) }, { probabilities }, th).pass;
      expect(pass('wait', { wait: choice, now: choice / 2, none: choice / 2 }, true)).toBe(true);
      expect(pass('wait', { wait: choice - 0.01, now: 0.3, none: 0.2 }, true)).toBe(false);
      expect(pass('wait', { wait: choice, now: choice, none: 0 }, true)).toBe(false);
      expect(pass('wait', { wait: 0.3, now: 0.7, none: 0 }, true)).toBe(false);
      expect([pass('yes', { yes, no: 1 - yes }, false), pass('yes', { yes: yes - 0.01, no: 1 - yes + 0.01 }, false)]).toEqual([true, false]);
      expect([pass('no', { yes: no, no: 1 - no }, false), pass('no', { yes: no + 0.01, no: 1 - no - 0.01 }, false)]).toEqual([true, false]);
    },
  );

  unit(
    'phrasings',
    {
      when: `a question gives \`${q('scenario')}\` as a list of phrasings.`,
      value: `each phrasing is asked on its own, and the question passes when most of them pass, so no single wording decides it.`,
    },
    async () => {
      const three = { ...WAIT, scenarios: ['A request failed.', 'The server answered 503.', 'The network dropped.'] };
      const asked = async (passing: number) => {
        const model = stub((request) => Object.fromEntries(request.questions.map((x, i) => [x.id, { probabilities: i < passing ? { wait: 0.9, now: 0.1, none: 0 } : { wait: 0.1, now: 0.9, none: 0 } }])));
        const result = await read(model.model, buildRequest('# Skill', [three]), [three], DEFAULT_THRESHOLDS);
        expect(model.calls[0]!.questions).toHaveLength(three.scenarios.length);
        return result.verdicts[0]!;
      };
      expect((await asked(2)).pass).toBe(true);
      expect((await asked(1)).pass).toBe(false);
      expect((await asked(2)).variantsPass).toEqual([true, true, false]);
    },
  );

  unit(
    'borderline',
    {
      when: 'a verdict is close to its threshold.',
      value: `a verdict within \`${threshold('margin')}\`, ${margin} by default, of its threshold is marked borderline: the next run may decide it the other way. A borderline pass still passes.`,
      values: { margin },
    },
    async () => {
      const near = stub((request) => Object.fromEntries(request.questions.map((x) => [x.id, { probabilities: { wait: choice + margin / 2, now: 1 - choice - margin / 2, none: 0 } }])));
      const ran = await runAll(skillProject(), near.model, collected({ ...question('wait'), ...WAIT, declared: { file: '/p/a.test.ts', line: 1 }, file: 'SKILL.md', sections: [], withFiles: [] }));
      expect(ran.requests[0]!.verdicts[0]).toMatchObject({ pass: true, borderline: true });
      expect(ran.ok).toBe(true);
      expect(ran.summary.borderline).toBe(1);
      const far = stub((request) => Object.fromEntries(request.questions.map((x) => [x.id, { probabilities: { wait: choice + margin * 2, now: 1 - choice - margin * 2, none: 0 } }])));
      expect((await runAll(skillProject(), far.model, collected({ ...question('wait'), ...WAIT, file: 'SKILL.md', sections: [], withFiles: [], declared: { file: '/p/a.test.ts', line: 1 } }))).requests[0]!.verdicts[0]!.borderline).toBe(false);
    },
  );

  unit(
    'what-the-model-reads',
    {
      when: 'a question is asked, or fails and the skill has to change.',
      value: `the model reads the built file that holds the question's unit, or the file of \`${ask.name}()\`: whole, or cut to the headings of \`${q('section')}\`. It reads the files of \`${q('with')}\` too, or every other file with \`${q('with')}: all\`, and the \`context\` of the settings. It never reads the tests. One request carries every question about the same file, \`${q('section')}\` and \`${q('with')}\`.`,
    },
    async () => {
      const config = { ...skillProject(), context: 'A client for JSON APIs.' };
      writeFileSync(join(config.skill, 'SKILL.md'), '# Skill\n\n## Retries\n\nRetry only GET requests.\n\n## Timeouts\n\nWait ten seconds.\n');
      writeFileSync(join(config.skill, 'errors.md'), '# Errors\n');
      writeFileSync(join(config.skill, 'clients.md'), '# Clients\n');
      const model = stub((request) => Object.fromEntries(request.questions.map((x) => [x.id, { probabilities: { yes: 0.9, no: 0.1 } }])));
      const declared = { file: '/project/src/a.skill.test.ts', line: 10 };
      await runAll(
        config,
        model.model,
        collected(
          question('whole', { sections: [], declared }),
          question('whole-too', { sections: [], declared }),
          question('cut', { sections: ['Retries'], declared }),
          question('with-one', { sections: [], withFiles: ['errors.md'], declared }),
          question('with-all', { sections: [], withFiles: 'all', declared }),
        ),
      );
      const [whole, cut, withOne, withAll] = model.calls;
      expect(model.calls).toHaveLength(4);
      expect(whole!.questions.map((x) => x.id)).toEqual(['whole', 'whole-too']);
      expect(whole!.state).toEqual({ skill: '# Skill\n\n## Retries\n\nRetry only GET requests.\n\n## Timeouts\n\nWait ten seconds.' });
      expect(cut!.state).toEqual({ skill: '## Retries\n\nRetry only GET requests.' });
      expect(Object.keys(withOne!.state.references as object)).toEqual(['errors.md']);
      expect(Object.keys(withAll!.state.references as object).sort()).toEqual(['clients.md', 'errors.md']);
      expect(whole!.instructions).toContain(config.context);
      for (const call of model.calls) expect(JSON.stringify(call)).not.toContain(declared.file);
    },
  );

  unit(
    'question-not-asked',
    {
      when: 'a question is missing from the verdicts.',
      value: `a question is not asked, and the report says why, when the skill folder does not have its unit yet (run \`${command('proof')} ${option('proof', '--write')}\`), when the test of its unit failed, or when its file is not in the skill folder.`,
    },
    async () => {
      const base = { scenario: 'A request failed.', question: 'Should the agent retry it?', expect: 'yes' };
      const p = await project((r) => {
        r.setup('demo', { file: 'SKILL.md', title: 'Demo', description: 'A skill to try SkillUnit on.', frontmatter: { name: 'demo', description: 'Use it to try SkillUnit.' } });
        r.unit('built', { when: 'x.', do: 'y.', ask: base });
        r.setup('retries', { file: 'retries.md', title: 'Retries', when: 'Retry a request', description: 'How requests are retried.' });
        r.unit('broken', { when: 'x.', do: 'y.', ask: base }, () => {
          throw new Error('the code changed');
        });
        r.ask('about-missing', { ...base, file: 'missing.md' });
      });
      p.proof({ write: true });
      const record = JSON.parse(p.read('tmp/skill-units/1-built.json'));
      p.write('tmp/skill-units/9-not-built.json', JSON.stringify({ ...record, id: 'not-built', order: 1, ask: [{ ...record.ask[0], id: 'not-built' }] }));
      const ran = report(await cli(p.root, [command('test'), option('test', '--dry-run'), option('test', '--json')]));
      const problems = ran.test!.problems.map((x) => x.message);
      expect(problems).toEqual(
        expect.arrayContaining([
          expect.stringContaining('the skill folder has no unit `not-built`'),
          expect.stringContaining('the test of the unit `broken` failed, so its questions were not asked'),
          expect.stringContaining('is about missing.md, which is not a file in the skill folder'),
        ]),
      );
      expect(ran.test!.requests.flatMap((r) => r.verdicts.map((v) => v.id))).toEqual(['built']);
    },
  );

  unit(
    'request-limits',
    {
      when: 'a file of the skill is large, or many questions are about it.',
      value: `a request larger than the model takes is not sent: the report says so, and names the largest parts. Questions with another \`${q('section')}\` go in a request of their own, so a large file can be asked about in parts.`,
    },
    async () => {
      const model = stub(() => ({}), { perQuestionTokens: 400, perRequestTokens: 800 });
      const config = skillProject();
      writeFileSync(join(config.skill, 'SKILL.md'), `# Skill\n\n## Retries\n\n${'Retry only GET requests. '.repeat(80)}\n\n## Timeouts\n\nWait.\n`);
      const ran = await runAll(config, model.model, collected(question('whole', { sections: [] }), question('small', { sections: ['Timeouts'] })));
      expect(ran.requests[0]!.error).toMatch(/^too large: .*Largest parts: the file under test/);
      expect(ran.requests[1]!.error).toBeUndefined();
      expect(model.calls).toHaveLength(1);
    },
  );
});
