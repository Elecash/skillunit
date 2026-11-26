// The file `testing/plan.md` of the skill: its `setup()`, then its units in the order the file shows them.
import { setup, unit } from 'skillunit/vitest';
import { describe } from 'vitest';

setup('testing-plan', {
  file: 'testing/plan.md',
  title: 'SkillUnit — planning the questions',
  when: 'Decide which questions a skill needs, and where each one goes',
  description: 'Which questions a skill needs, and where each one is declared.',
});

describe('testing/plan.md', () => {
  unit('question-with-its-unit', {
    when: 'the agent writes a question about a rule of the skill.',
    do: "put it in the `ask` of the rule's `unit()`, so it is asked about the file that holds the unit; a question about something no unit says goes in `ask()`, after the `setup()` of the file it is about.",
    ask: {
      id: 'where-a-question-goes',
      scenario: 'A skill has a `SKILL.md` and four feature files. The agent writes a question about a rule of `features/retries.md`, which a test declares with `unit()`.',
      question: 'Where should the question go?',
      options: {
        unit: "In the `ask` of that rule's `unit()`",
        'skill-file': 'In an `ask()` about `SKILL.md`, which lists every file',
        separate: 'In a file of questions of its own, next to the skill',
      },
      expect: 'unit',
    },
  });

  unit('section-for-long-files', {
    when: 'the file a question is about is long, above about 3,000 characters.',
    do: 'give the question a `section`, the heading that states its rule, so the request sends only that part; a heading that is itself longer than that takes its subheading.',
    evenWhen: 'the file is short; then a question with no `section` reads it whole.',
    ask: {
      id: 'long-file',
      scenario: 'A file of the skill is 12,000 characters, with five headings of about 2,000 characters each. The agent writes a question about a rule under one of them.',
      question: 'What should the question send to the decision model?',
      options: {
        'per-heading': 'Only that heading, with `section` set to it',
        whole: 'The whole file',
        'one-list': 'A `section` that lists all five headings',
      },
      expect: 'per-heading',
    },
  });

  unit('with-only-what-the-agent-reads', {
    when: 'a rule reaches the agent from more than one file, and a mistake costs a lot.',
    do: 'add a question whose `with` lists the files the agent reads for the task it describes, and keep the question without `with` too.',
    ask: {
      id: 'with-files',
      scenario: 'A skill has ten files. For the task a question describes, the agent reads two of them. The agent adds a question that checks the rule together with what the agent reads.',
      question: 'What should `with` list?',
      options: {
        two: 'The two files the agent reads for that task',
        all: '`all`, so the reader has every file',
        'none-listed': 'Nothing; only the file of the unit',
      },
      expect: 'two',
    },
  });

  unit('list-the-decisions-first', {
    when: 'the agent is about to write the questions of a file.',
    do: 'list the decisions the file forces, the places where an agent that read it acts differently from one that did not, and show the list to the user when they have not said which parts matter.',
    evenWhen: 'the file looks small; a sentence that changes nothing an agent does gets no question.',
    ask: {
      id: 'show-the-list',
      scenario: [
        'The user says "add SkillUnit tests to our skill" and nothing about which parts matter.',
        'The user asks for tests for the skill without saying what to focus on.',
      ],
      question: 'What should the agent do before writing the questions?',
      options: {
        show: 'List the decisions each file forces and show the list to the user',
        everything: 'Write a question for every sentence of the skill',
        'top-three': 'Pick the three rules that look most important and ask only about those',
      },
      expect: 'show',
    },
  });
});
