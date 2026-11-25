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
