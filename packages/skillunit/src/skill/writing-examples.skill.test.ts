// The units of skills-src/skillunit/writing/examples.md that no test proves, and the questions about that
// file. `skillunit proof` puts each unit where the source has `{{unit:<id>}}`. See docs/proof.md.
import { unit } from '../vitest.js';

unit('complete-examples', {
  when: 'the agent writes an example.',
  do: 'make it compile on its own: declare every name it uses in the block.',
  ask: {
    id: 'undefined-name',
    scenario: 'An example calls `api.get("users")`, and nothing in the file declares `api`.',
    question: 'What should the agent do?',
    options: {
      declare: 'Declare `api` in the example, so the example compiles',
      'no-check': 'Mark the block `no-check`',
      leave: 'Leave it; readers can guess what `api` is',
    },
    expect: 'declare',
  },
});

unit('signatures-in-tables', {
  when: 'the agent shows a signature or the shape of an object rather than code to copy.',
  do: 'put it in a table or in inline code.',
  examples: [
    { lang: 'md', text: '| Call | Resolves to |\n| --- | --- |\n| `tf.get(path, options)` | the parsed body |' },
  ],
  ask: {
    id: 'signature-block',
    scenario: 'The agent wants to show the signature `get(path, options)` of a method.',
    question: 'How should it show it?',
    options: {
      table: 'In a table or in inline code',
      'ts-block': 'In a fenced `ts` block on its own',
    },
    expect: 'table',
  },
});

// Declared with no body: no test of SkillUnit checks it.
unit('language-on-every-example', { when: 'the agent writes a fenced block under `Right` or a path of `Decide`.', do: 'name its language after the opening fence, such as `ts`, `sh` or `yaml`.' });
