// The units of skills-src/skillunit/testing/results.md that no test proves, and the questions about that
// file. `skillunit proof` puts each unit where the source has `{{unit:<id>}}`. See docs/proof.md.
import { ask, unit } from '../vitest.js';

unit('dry-run-first', {
  when: 'the agent has written or changed questions.',
  do: 'run `npx skillunit test --dry-run` and fix what it reports before the real run.',
  examples: [
    { lang: 'sh', text: 'npx skillunit test --dry-run' },
  ],
  ask: {
    scenario: 'The agent has just written three questions.',
    question: 'What should it run first?',
    options: {
      dry: '`npx skillunit test --dry-run`',
      run: '`npx skillunit test`',
      prove: `The check that deletes each rule's sentence`,
    },
    expect: 'dry',
  },
});

unit('prove-on-a-copy', {
  when: 'the agent wants to show that a question depends on its rule.',
  do: 'copy the skill folder, delete the rule\'s sentence in the copy, and run `npx skillunit test --skill <copy>`; the question must fail.',
  examples: [
    { lang: 'sh', text: `cp -R skills/my-skill /tmp/my-skill-copy
npx skillunit test --skill /tmp/my-skill-copy` },
  ],
  ask: {
    scenario: 'The agent wants to prove that a question depends on its rule.',
    question: `Where should it delete the rule's sentence?`,
    options: {
      copy: 'In a copy of the skill folder, then run with `--skill <copy>`',
      real: 'In the real skill, restoring it with git afterwards',
      scenario: `In the question's scenario`,
    },
    expect: 'copy',
  },
});

unit('still-green-without-the-rule', {
  when: 'a question still passes on a copy with its rule deleted.',
  do: 'look for the cause in this order: an option gives the answer away, the scenario contains the answer, the skill states the rule somewhere else, the reader knows the answer without the skill; fix the question in the first two cases, and tell the user in the last two.',
  ask: {
    id: 'still-green',
    scenario: `The agent deleted a rule's sentence from a copy of the skill, and the rule's question still passes.`,
    question: 'What should the agent check first?',
    options: {
      options: 'Whether one of the options gives the answer away',
      threshold: 'Whether the `choice` threshold is too low',
      delete: 'Nothing; it should delete the question',
    },
    expect: 'options',
  },
});

unit('no-mutations', {
  when: 'the user asks for mutation testing of the questions.',
  value: 'SkillUnit has no mutations; deleting a rule\'s sentence in a copy and asking the questions about the copy (see `prove-on-a-copy`) does the same job.',
  unknown: 'there is no mutation setting or tool; say so instead of adding one to the questions.',
  ask: {
    id: 'user-asks-for-mutations',
    scenario: [
      'The user asks the agent to add mutations to the questions.',
      'The user wants mutation testing for their SkillUnit tests.',
    ],
    question: 'What should the agent do?',
    options: {
      explain: `Explain that SkillUnit has no mutations, and that deleting a rule's sentence in a copy and asking the questions about the copy does the same job`,
      block: 'Add a `mutations` key to each question',
      tool: 'Look for a separate mutation-testing tool',
    },
    expect: 'explain',
  },
});

unit('report-dont-bend', {
  when: 'a question fails on the unmodified skill, and the question looks right.',
  do: 'report the failure as a finding about the skill, with the sentence that would fix it; never change the question only so it passes, and never lower the thresholds.',
  evenWhen: 'the user wants the run green; a question bent to pass protects nothing.',
  ask: {
    scenario: [
      'A question fails on the unmodified skill, and the agent thinks the question is right.',
      'The reader picked a different answer from the expected one, and the question looks correct.',
    ],
    question: 'What should the agent do?',
    options: {
      report: 'Report the failure as a finding about the skill and suggest the sentence that would fix it',
      expected: 'Change `expect` to the answer the reader picked',
      threshold: 'Lower the thresholds until the question passes',
    },
    expect: 'report',
  },
});

unit('fix-when-asked', {
  when: 'a question fails because the skill is unclear, and the user asked the agent to improve the skill.',
  do: `rewrite the unclear part of the skill, adding the idea the rule is missing rather than the question's wording, and ask the question again.`,
  ask: {
    scenario: [
      'The user said "if a question shows the skill is unclear, rewrite that part of the skill". A question fails because the skill is unclear.',
      'The user asked the agent to improve the skill wherever the questions show it is unclear, and one question does.',
    ],
    question: 'What should the agent do?',
    options: {
      edit: 'Rewrite the unclear part of the skill, adding the idea the rule is missing, and ask the question again',
      report: 'Leave the skill as it is and report the failure with a suggested sentence',
      test: 'Rewrite the question so it passes',
    },
    expect: 'edit',
  },
});

unit('strengthen-borderline-questions', {
  when: 'the report marks a verdict borderline.',
  do: 'make the skill\'s text more direct on that point, or give the question more phrasings, since it passes when most of them pass and one phrasing cannot decide it; leave `thresholds.margin` as it is.',
  ask: {
    id: 'borderline-pass',
    scenario: 'A question passes, but the report marks it borderline.',
    question: 'What should the agent do?',
    options: {
      strengthen: `Make the skill's text more direct on that point, or add phrasings to the question`,
      margin: 'Raise `thresholds.margin` until the mark goes away',
      ignore: 'Nothing; it passed',
    },
    expect: 'strengthen',
  },
});

ask('read-none', {
  file: 'testing/results.md',
  scenario: 'A failing question shows `none 90%` in the distribution.',
  question: 'What does that mean?',
  options: {
    missing: 'The reader did not find the rule in the text',
    elsewhere: 'The text points to a different answer',
    ambiguous: 'The text is ambiguous',
  },
  expect: 'missing',
});

ask('read-weak', {
  file: 'testing/results.md',
  scenario: 'A failing question shows the expected answer, under the threshold.',
  question: 'What does that mean?',
  options: {
    missing: 'The reader did not find the rule in the text',
    elsewhere: 'The text points to a different answer',
    ambiguous: 'The text is ambiguous',
  },
  expect: 'ambiguous',
});
