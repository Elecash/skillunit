// The units of the skill these tests prove, beside the parser's other tests in parse.test.ts.
// `skillunit proof` runs the files named `*.skill.test.ts` only. See docs/proof.md.
import { expect } from 'vitest';
import { unit } from '../vitest.js';
import { parseCheck } from './parse.js';
import { messages, parse } from './testing.js';

unit('check-regex-in-a-code-span', {
    when: "a rule's mistake can be matched by a regex.",
    do: 'add `Check: forbid` with the regex inside backticks, followed by `in` and the fence languages it applies to.',
    check: 'forbid `/Check: forbid \\//` in md',
    ask: {
      id: 'check-format',
      scenario: 'The agent adds a check that no example passes `retry` to `tf.post`.',
      question: 'Which line should it write?',
      options: {
        span: '`Check: forbid`, then the regex inside backticks, then `in ts`',
        bare: '`Check: forbid`, then the regex bare between its slashes, then `in ts`',
      },
      expect: 'span',
    },
  }, (u) => {
  u.example('md', 'Check: forbid `/\\.(post|patch)\\([^)]*retry/` in ts');
  expect(messages('### rule: r\nCheck: forbid /post.*retry/ in ts\n')).toEqual([
    '2: put the regex of a `Check` in backticks, as in ``forbid `/regex/` in ts``: outside a code span, Markdown reads `*` and `_` as emphasis and a formatter rewrites them',
  ]);
  expect(parseCheck('forbid `/a/i` in ts, TSX', 3)).toMatchObject({ mode: 'forbid', langs: ['ts', 'tsx'], line: 3 });
  expect(parseCheck('forbid `/a/` in python, Bash, typescript', 1)).toMatchObject({ langs: ['py', 'sh', 'ts'] });
  expect(parseCheck('forbid ``/a`b/`` in ts', 1)).toMatchObject({ regex: /a`b/ });
});

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
  }, () => {
  const file = parse('### decision: d\nDecide:\n- **a** — x\nEven when: y\n');
  expect(file.errors.map((e) => `${e.line}: ${e.message}`)).toEqual([
    '4: leave a blank line between the list and `Even when:`; without it, Markdown reads the label as part of the last list item',
  ]);
  expect(file.units[0]!.evenWhen).toBe('y');
  expect(file.units[0]!.decide[0]!.condition).toBe('x');
});
