// The units of skills-src/skillunit/testing/tests.md that no test proves, and the questions about that
// file. `skillunit proof` puts each unit where the source has `{{unit:<id>}}`. See docs/proof.md.
import { NONE } from '../unit/contract.js';
import { ask, unit } from '../vitest.js';

unit('scenario-without-the-answer', {
  when: 'the agent writes the scenario of a question.',
  do: `describe the situation as the agent meets it, in the user's words, without the rule or its reason.`,
  examples: [
    { lang: 'ts', text: "scenario: 'Production is down after a deploy, and the user has a fix ready.'," },
  ],
  ask: {
    id: 'scenario-without-reason',
    scenario: 'The rule is "when production is down, roll back instead of deploying a fix, because a rollback takes a minute and a fix takes ten". The agent is writing the scenario for this rule.',
    question: 'Which scenario should it write?',
    options: {
      plain: 'Production is down after a deploy, and the user has a fix ready.',
      leaky: 'Production is down after a deploy; a rollback takes a minute and a fix takes ten.',
    },
    expect: 'plain',
  },
});

unit('ask-about-an-action', {
  when: 'the agent writes what a question asks.',
  do: 'ask what the agent should do in the situation, never what the text mentions.',
  examples: [
    { lang: 'ts', text: "question: 'What should the agent do first?'," },
  ],
  ask: {
    id: 'ask-about-action',
    scenario: 'The agent is writing a question about the rollback rule.',
    question: 'What should the question ask?',
    options: {
      action: 'What should the agent do first?',
      recall: 'Does the skill mention rollbacks?',
    },
    expect: 'action',
  },
});

unit('prefer-choice-questions', {
  when: 'the agent chooses between a question with options and a yes/no question.',
  do: 'write one with options, and keep yes/no for a decision with exactly two outcomes that common sense would get wrong.',
  ask: {
    id: 'prefer-choice',
    scenario: 'The rule is "never commit the API key", and the agent is choosing the kind of question.',
    question: 'Which kind of question should it write?',
    options: {
      choice: 'A question with options, such as where the key should go',
      'yes-no': 'A yes/no question asking whether the agent may commit the key',
    },
    expect: 'choice',
  },
});

unit('ask-where-the-rule-allows', {
  when: 'a rule forbids something in some cases and allows it in others.',
  do: 'add a question about a case the rule allows, and expect the agent to go ahead there.',
  examples: [
    {
      lang: 'ts',
      text: `{
  id: 'put-may-retry',
  scenario: 'A settings document is replaced with \`tf.put\`, and the API sometimes answers 503.',
  question: 'Should the agent pass \`retry\` to that call?',
  options: {
    retry: 'Yes, \`retry\` is allowed for this method',
    'no-retry': 'No, leave \`retry\` off for this method',
  },
  expect: 'retry',
}`,
    },
  ],
  ask: {
    id: 'allowed-side',
    scenario: 'A rule forbids `retry` on POST and allows it on PUT. The agent has written one question for it, about a POST, where `retry` must stay off.',
    question: 'Which other question should it add?',
    options: {
      allowed: 'A question about a PUT, a case the rule allows, that expects the agent to pass `retry`',
      'another-post': 'A question about a second POST, phrased differently, that expects `retry` to stay off',
      'none-more': 'No other question; the POST covers the rule',
    },
    expect: 'allowed',
  },
});

unit('ask-where-the-skill-is-silent', {
  when: 'the skill leaves out a task close to the ones it covers.',
  do: 'write one question about that task with options an agent might stretch the skill to, and expect `none`.',
  ask: {
    id: 'silent-task',
    scenario: 'The skill is a deploy checklist that never mentions database migrations. The agent is writing the questions for that skill.',
    question: 'What should the agent do about migrations?',
    options: {
      silent: `Write a question about migrations whose expected answer is \`${NONE}\``,
      skip: 'Write no question about migrations; only ask about what the skill covers',
      closest: 'Write a question that expects the command closest to a migration',
    },
    expect: 'silent',
  },
});

unit('options-cover-the-rule', {
  when: 'the agent writes the options of a question.',
  do: 'make each option say everything the skill says on the point, and make the options differ only in what the question checks.',
  examples: [
    {
      lang: 'ts',
      text: `options: {
  exact: 'Quote the command in backticks, and ask which command, exactly as written, the skill gives',
  loose: 'Quote the command in backticks, and ask which command the skill gives',
},`,
    },
  ],
  ask: {
    id: 'incomplete-option',
    scenario: `The skill says to quote a command in backticks and ask for it "exactly as written". The agent's expected option mentions only "exactly as written".`,
    question: 'What should the agent change?',
    options: {
      cover: 'Make each option include the backticks as well, so the options differ only in "exactly as written"',
      keep: 'Nothing; the expected option names the part that matters most',
      'none-expect': `Expect \`${NONE}\`, since no option says everything`,
    },
    expect: 'cover',
  },
});

unit('tempting-wrong-options', {
  when: 'the agent writes the wrong options of a question.',
  do: 'use the answers an agent would give if the rule were missing, such as the shortcut, the default, or what the user literally asked for.',
  ask: {
    id: 'tempting-wrong-answer',
    scenario: 'The user asks to deploy a feature branch to production. The rule is "production deploys come from main only; other branches get a preview", so the question expects "only a preview", and the agent is choosing the wrong option to put next to it.',
    question: 'Which wrong option should it use?',
    options: {
      tempting: 'Run `npm run deploy` from that branch, as the user asked',
      absurd: 'Roll back the branch',
    },
    expect: 'tempting',
  },
});

unit('expect-none-only-for-silence', {
  when: 'the agent sets `expect` and no option matches what the skill says.',
  do: 'add an option that says what the skill says, and expect it; expect `none` only where the skill should be silent.',
  ask: {
    id: 'add-the-answer',
    scenario: 'The agent is writing a question about the rule "when CI is red, stop and say so". None of the options it has written so far says to stop.',
    question: 'How should it set the expected answer?',
    options: {
      add: 'Add an option that says to stop and say so, and expect that option',
      'expect-none': `Set the expected answer to SkillUnit's automatic \`${NONE}\``,
      closest: 'Expect the option closest to stopping',
    },
    expect: 'add',
  },
});

unit('ask-for-exact-values', {
  when: 'a question checks a value whose spelling matters, such as a command, a file name or a flag.',
  do: 'quote the value in backticks in the options, and ask for it "exactly as written".',
});

unit('short-option-labels', {
  when: 'the agent names the options of a question.',
  do: 'label each option with a short lowercase word or two (`stop`, `no-retry`), and put the meaning in its description.',
  ask: {
    id: 'option-labels',
    scenario: 'The agent is naming the options of a question.',
    question: 'Which labels should it use?',
    options: {
      short: 'Short lowercase words such as `stop` and `deploy`, with the meaning in the description',
      sentences: 'The full sentence of each answer as the label',
      letters: '`a`, `b`, `c`',
    },
    expect: 'short',
  },
});

unit('options-from-the-code', {
  when: 'an option of a question names a value the code has, such as a default.',
  do: 'build the option from the code in a template string, as the sentence of the unit is, so the question follows the code when the value changes.',
  examples: [
    { lang: 'ts', text: 'options: { right: `${DEFAULT_TIMEOUT / 1000} seconds`, longer: `${(3 * DEFAULT_TIMEOUT) / 1000} seconds` },' },
  ],
  ask: {
    id: 'option-of-a-default',
    scenario: 'The agent writes a question about the default timeout of a library whose code exports `DEFAULT_TIMEOUT = 10_000`.',
    question: 'How should it write the option that gives the right answer?',
    options: {
      built: '`${DEFAULT_TIMEOUT / 1000} seconds`, built from the constant',
      literal: '`10 seconds`, typed into the option',
    },
    expect: 'built',
  },
});

ask('extra-key', {
  file: 'testing/tests.md',
  scenario: 'The agent adds a `description` key to a question to explain it.',
  question: 'What happens when the test that declares the question runs?',
  options: {
    error: 'The test fails, because `description` is not a key of a question',
    ignored: 'SkillUnit ignores the key and asks the question',
    shown: 'SkillUnit prints the description in the report',
  },
  expect: 'error',
});
