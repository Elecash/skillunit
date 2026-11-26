// The units of skills-src/skillunit/writing/units.md that no test proves, and the questions about that
// file. `skillunit proof` puts each unit where the source has `{{unit:<id>}}`. See docs/proof.md.
import { unit } from '../vitest.js';

unit('pick-a-kind', {
  when: 'the agent turns an instruction of the skill into a unit.',
  decide: 'which kind of unit to write.',
  paths: [
    { path: 'rule', when: 'a constraint on what the agent writes or does: one `Do`.' },
    { path: 'decision', when: 'the agent chooses between paths that depend on the situation: one `- **path** — condition` item per path under `Decide`.' },
    { path: 'fact', when: 'a value the agent must state exactly, such as a default or a limit: `Value`, and `Unknown` for what the value does not cover.' },
  ],
  evenWhen: 'a rule seems to need two `Do` lines; that is two rules, or a decision.',
  ask: [
    {
      id: 'default-value',
      scenario: 'The agent writes down that a request waits 10 seconds by default.',
      question: 'Which kind of unit should it write?',
      options: {
        fact: 'A `fact`, with `Value` and `Unknown`',
        rule: 'A `rule`, with `Do`',
        decision: 'A `decision`, with one path',
      },
      expect: 'fact',
    },
    {
      id: 'two-paths',
      scenario: 'The agent writes down that one client is right for many calls to one API, and direct calls for one-off requests.',
      question: 'Which kind of unit should it write?',
      options: {
        decision: 'A `decision`, with one path per case',
        rule: 'One `rule` whose `Do` covers both cases',
        fact: 'A `fact`',
      },
      expect: 'decision',
    },
  ],
});

// The units below are declared with no body: no test of SkillUnit checks them.
unit('labels-in-order', {
  when: 'the agent writes or edits a unit.',
  do: 'keep the labels in one order: `When`; `Do`, `Decide` or `Value`; `Unknown`; `Even when`; then `Right`.',
});

unit('one-label-per-paragraph', {
  when: 'the agent writes the labels of a unit.',
  do: 'put each label in a paragraph of its own, with a blank line before and after it.',
  examples: [{ lang: 'md', text: 'When: a request may be retried.\n\nDo: enable `retry` only for GET, HEAD, PUT and DELETE.' }],
  ask: {
    id: 'label-layout',
    scenario: 'The agent writes `When:` and `Do:` of a new unit.',
    question: 'How should they be laid out?',
    options: {
      paragraphs: 'Each label in a paragraph of its own, with a blank line between them',
      lines: 'One label per line, with no blank line between them',
      'one-line': 'Both on one line, separated by a full stop',
    },
    expect: 'paragraphs',
  },
});

unit('id-names-the-instruction', { when: 'the agent names a unit.', do: 'use a kebab-case id that names the instruction, unique across the skill, such as `retry-idempotent-only`.' });

unit('blank-line-after-a-list', {
  when: 'a label follows a list, such as the items of `Right` or the paths of `Decide`.',
  do: 'leave a blank line between the last item and the label.',
  ask: {
    id: 'label-after-list',
    scenario: 'The last path of a `Decide` list is written, and `Even when:` comes next.',
    question: 'What goes between them?',
    options: {
      blank: 'A blank line',
      nothing: 'Nothing; `Even when:` starts on the next line',
      indent: '`Even when:` indented under the last path',
    },
    expect: 'blank',
  },
});
