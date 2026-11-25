// The units of skills-src/skillunit/writing/files.md that no test proves, and the questions about that
// file. `skillunit proof` puts each unit where the source has `{{unit:<id>}}`. See docs/proof.md.
import { unit } from '../vitest.js';

unit('one-task-per-file', {
  when: 'a skill grows, or a file covers more than one task.',
  do: 'give each task its own file, named after the thing or feature it covers, and split a file when an agent doing one task needs only part of it.',
  evenWhen: 'the two tasks share a few rules; the shared rule lives in the more specific file, and the other links to it.',
  ask: {
    id: 'big-skill',
    scenario: 'A library skill has grown to one `SKILL.md` of 900 lines about calendars, forms, translations and theming.',
    question: 'How should the agent restructure it?',
    options: {
      split: 'One file per thing or feature, such as `widgets/calendar.md`, reached from an index in `SKILL.md`',
      headings: 'Keep one file and add more headings',
      two: 'Split it into two halves of 450 lines',
    },
    expect: 'split',
  },
});

unit('instructions-only-in-units', {
  when: 'a sentence in a reference section tells the agent what to do, or gives an exception to a rule.',
  do: 'write the instruction as a unit, and the exception inside its unit, under `Even when`; the prose only describes.',
  evenWhen: 'the exception is one short clause; the reader follows the most specific rule it finds, so an exception stated before the rule loses to it.',
  ask: {
    id: 'exception-placement',
    scenario: 'A rule says to keep the default timeout. Uploads are the exception, and the agent is adding that to the skill.',
    question: 'Where should the exception go?',
    options: {
      inside: 'Inside the rule\'s unit, under `Even when` or in its `Do`',
      intro: 'In the introduction of the file, before the rules',
      note: 'In a separate note after the rules',
    },
    expect: 'inside',
  },
});
