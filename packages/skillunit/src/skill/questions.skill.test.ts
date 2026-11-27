// The file `questions.md` of SkillUnit's own skill: its `setup()`, then its units in the order the file shows them.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, ask, code, key, or, setup, type UnitQuestion, type UnitSpec, unit } from 'skillunit/vitest';
import { afterEach, describe, expect } from 'vitest';
import { DEFAULT_THRESHOLDS, type Thresholds } from '../config.js';
import { buildRequest, judge, read } from '../test/reader.js';
import { runAll } from '../test/runner.js';
import { checkQuestions, DEFAULT_SKILL_FILE, NONE, QUESTION_KEYS } from '../unit/contract.js';
import { cleanUp, cli, collected, command, option, project, question, report, runner, skillProject, stub } from './helpers.js';

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
    expect(sent.slice(0, 2), 'the options of the question are sent').toEqual(['wait', 'now']);
    expect(sent.at(-1), `${NONE} is added`).toBe(NONE);
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
      // The exception to apply: a tie at the top, at the threshold.
      ask: {
        id: 'tie-at-the-top',
        scenario: `A question expects \`wait\`. The model gives \`wait\` and \`now\` the same probability, ${choice} each, and \`${NONE}\` none.`,
        question: 'Does the question pass?',
        expect: 'no',
      },
    },
    () => {
      const th = { ...DEFAULT_THRESHOLDS };
      const pass = (expect: string, probabilities: Record<string, number>, options: boolean) => judge({ ...WAIT, expect, ...(options ? {} : { options: undefined }) }, { probabilities }, th).pass;
      // Each threshold, at it and just past it.
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
      /** Whether the question passes when the phrasings marked true pass. */
      const asked = async (passing: boolean[]) => {
        const model = stub((request) => Object.fromEntries(request.questions.map((x, i) => [x.id, { probabilities: passing[i] ? { wait: 0.9, now: 0.1, none: 0 } : { wait: 0.1, now: 0.9, none: 0 } }])));
        const result = await read(model.model, buildRequest('# Skill', [three]), [three], DEFAULT_THRESHOLDS);
        expect(model.calls[0]!.questions).toHaveLength(three.scenarios.length);
        expect(result.verdicts).toHaveLength(1);
        return result.verdicts[0]!;
      };
      expect((await asked([true, true, false])).pass).toBe(true);
      expect((await asked([true, false, false])).pass).toBe(false);
      // Not the first wording: any two of the three.
      expect((await asked([false, true, true])).pass).toBe(true);
      expect((await asked([true, true, false])).variantsPass).toEqual([true, true, false]);
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
      const of = (id: string) => model.calls.find((c) => c.questions.some((x) => x.id === id))!;
      expect(model.calls).toHaveLength(4);
      expect(of('whole').questions.map((x) => x.id)).toEqual(['whole', 'whole-too']);
      expect(of('whole').state).toEqual({ skill: '# Skill\n\n## Retries\n\nRetry only GET requests.\n\n## Timeouts\n\nWait ten seconds.' });
      expect(of('cut').state).toEqual({ skill: '## Retries\n\nRetry only GET requests.' });
      expect(Object.keys(of('with-one').state.references as object)).toEqual(['errors.md']);
      expect(Object.keys(of('with-all').state.references as object).sort()).toEqual(['clients.md', 'errors.md']);
      expect(of('whole').instructions).toContain(config.context);
      for (const call of model.calls) expect(JSON.stringify(call)).not.toContain(declared.file);
    },
  );

  unit(
    'question-not-asked',
    {
      when: 'a question is missing from the verdicts.',
    },
    async (u) => {
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
      expect(ran.test!.requests.flatMap((r) => r.verdicts.map((v) => v.id))).toEqual(['built']);
      // Each case: what the report says, and the reason the sentence gives.
      const cases: [string, string][] = [
        ['the skill folder has no unit `not-built`', `when the skill folder does not have its unit yet (run \`${command('proof')} ${option('proof', '--write')}\`)`],
        ['the test of the unit `broken` failed, so its questions were not asked', 'when the test of its unit failed'],
        ['is about missing.md, which is not a file in the skill folder', 'when its file is not in the skill folder'],
      ];
      for (const [says] of cases) expect(problems).toContainEqual(expect.stringContaining(says));
      u.value(`a question is not asked, and the report says why, ${or(cases.map(([, when]) => when))}.`);
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
      expect(model.calls.map((c) => c.questions.map((x) => x.id))).toEqual([['small']]);
    },
  );

  // A gap: which unit an agent would get wrong is judgement; no test of SkillUnit can state it.
  unit('when-to-ask', {
    when: 'a test decides whether a unit gets a question.',
    do: 'give a question to a rule or a decision an agent would plausibly get wrong, and to a fact whose sentence leaves something to work out: two values to combine, an exception to apply. A fact that states one value from the code gets no question.',
    evenWhen: 'the user asks for a question on every unit: a question about one value its test already proves adds only a chance to fail on a wording.',
    ask: {
      id: 'which-units-get-a-question',
      scenario: 'A skill has rules, decisions, and facts that each state one value built from the code. The user asks for questions, so that the decision model covers the skill.',
      question: 'Which units does the agent give a question?',
      options: {
        plausible: 'The rules and decisions an agent could get wrong, and the facts that leave something to work out',
        every: 'Every unit, so that each one is covered by the decision model',
        facts: 'Every fact, since its value is the part that can drift',
      },
      expect: 'plausible',
    },
  });

  // A gap: how a scenario reads to a model is judgement; `phrasings` is how SkillUnit asks it.
  unit('scenario-pulls', {
    when: 'a test writes the scenario and the options of a question.',
    do: "write the scenario so that it pulls toward the wrong answer: the user asks for what the rule forbids, or the shortcut is in plain sight. The wrong options are the answers an agent gives without the unit.",
    evenWhen: 'a plain scenario reads better: common sense then passes the question, whatever the unit says.',
    ask: {
      id: 'a-scenario-that-pulls',
      scenario: 'A rule says to leave `retry` off a POST request. The agent drafts its question with the scenario "An order is created with a POST request."',
      question: 'Is the scenario ready?',
      options: {
        pull: 'No: it needs what pulls toward retrying, such as a network that drops now and then, or a user who asks for retries',
        ready: 'Yes: it names the method the rule is about, and a scenario should not hint at the answer',
      },
      expect: 'pull',
    },
  });

  // A gap: what a reader concludes is judgement; `unknown` is the key a fact has for it.
  unit('no-sums-no-absence', {
    when: 'a question would have the reader work out a number, or decide that something does not exist.',
    do: `do not ask the reader to add numbers up, or to conclude from a list that what it leaves out does not exist. When the skill must say that something is not there, a fact says it in so many words, in \`${key<UnitSpec>('unknown')}\`.`,
    evenWhen: 'the list is complete: shown "these options and no other", a reader still does not say that an option is missing.',
    ask: {
      id: 'say-it-is-not-there',
      scenario: 'A fact lists the options of a request, and none of them is a connect timeout. The agent wants the skill to keep agents from inventing one.',
      question: 'What does the agent change?',
      options: {
        unknown: `It gives the fact an \`${key<UnitSpec>('unknown')}\` that says there is no connect timeout`,
        list: 'Nothing: the list shows every option, so a question can ask whether a connect timeout is among them',
      },
      expect: 'unknown',
    },
  });

  // A gap: the change is the user's to make; `skill-copy` is how SkillUnit asks about a copy.
  unit('prove-a-question', {
    when: 'a question passes, and the test should show that the question reads its unit.',
    do: `in a copy of the skill folder, write the opposite in the sentence of its unit, keep its heading and its \`When\`, and ask with \`${command('test')} ${option('test', '--skill')} <copy> ${option('test', '--no-run')}\`: the question must fail. A question that still passes does not read its unit: change the question, never a threshold.`,
    evenWhen: 'the question also passes with the text of its unit deleted: the model knows the library, which is the normal case, and the question is the one that fails the day the skill says something else.',
    ask: {
      id: 'question-against-the-opposite',
      scenario: [
        'The agent added a question to a unit about a library the model knows well. The question passes on the skill, and it also passes on a copy where the text of its unit is deleted. The user asks whether to drop it.',
        'A question passes on the skill and on a copy without the text of its unit, since the model knows the API. The user wants to drop it, because the unit seems to make no difference.',
      ],
      question: 'What does the agent do with the question?',
      options: {
        opposite: 'Ask it on a copy where its unit says the opposite, and keep it if it fails there',
        drop: 'Drop it: it passes without its unit, so the unit is not what answers it',
        threshold: 'Raise its threshold until it fails without its unit',
      },
      expect: 'opposite',
    },
  });
});
