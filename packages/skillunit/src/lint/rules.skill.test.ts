// The units of the skill these tests prove, beside lint's other tests in rules.test.ts.
// `skillunit proof` runs the files named `*.skill.test.ts` only. See docs/proof.md.
import { expect } from 'vitest';
import { LABELS } from '../units/index.js';
import { unit } from '../vitest.js';
import { F, skillOf, show, structureOf } from './testing.js';
import { structure } from './structure.js';

unit('labels-in-order', {
    when: 'the agent writes or edits a unit.',
    // The names and their order are the ones lint checks, from \`LABELS\`.
    do: `keep the labels in one order: \`${LABELS[0]}\`; \`${LABELS[1]}\`, \`${LABELS[2]}\` or \`${LABELS[3]}\`; \`${LABELS[4]}\`; \`${LABELS[5]}\`; \`${LABELS[6]}\`; then \`${LABELS[7]}\`.`,
  }, () => {
  expect(structureOf(`## Rules\n\n### rule: r\n\nWhen: x\n\nRight:\n\n${F}ts\na\n${F}\n\nDo: y\n`)).toEqual([
    '13 r error: `Do` goes before `Right`; the order is When, Do, Decide, Value, Unknown, Even when, Right, Check',
  ]);
  expect(structureOf('## Rules\n\n### rule: r\n\nCheck: forbid `/x/` in ts\n\nWhen: x\n\nDo: y\n')[0]).toMatch(/^7 r error: `When` goes before `Check`/);
});

unit('one-label-per-paragraph', {
    when: 'the agent writes the labels of a unit.',
    do: 'put each label in a paragraph of its own, with a blank line before and after it.',
    check: 'forbid `/^When: .*\\n(Do|Decide|Value):/m` in md',
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
  }, (u) => {
  u.example('md', 'When: a request may be retried.\n\nDo: enable `retry` only for GET, HEAD, PUT and DELETE.');
  expect(structureOf('## Rules\n\n### rule: r\nWhen: x\nDo: y\nCheck: forbid `/x/` in ts\n')).toEqual([
    '5 r warning: put `Do:` in a paragraph of its own, with a blank line before it',
    '6 r warning: put `Check:` in a paragraph of its own, with a blank line before it',
  ]);
});

unit('id-names-the-instruction', { when: 'the agent names a unit.', do: 'use a kebab-case id that names the instruction, unique across the skill, such as `retry-idempotent-only`.' }, () => {
  expect(structureOf('## Rules\n\n### rule: Retry_Once\n\nWhen: x\n\nDo: y\n')).toEqual([
    '3 Retry_Once error: `Retry_Once` is not kebab-case: use lowercase words joined by hyphens',
  ]);
  const unit = '## Rules\n\n### fact: same\n\nWhen: x\n\nValue: y\n';
  const problems = structure(skillOf({ 'a.md': unit, 'b.md': unit }));
  expect(problems.map((p) => `${p.file}:${show(p)}`)).toEqual([
    'b.md:3 same error: the id `same` is already used at a.md:3; ids are unique across the skill',
  ]);
});

unit('rules-section-last', {
    when: 'the agent writes the units of a file.',
    do: 'put every unit under one `## Rules` heading, the last `##` section of the file, with nothing else in it.',
    ask: {
      id: 'unit-placement',
      scenario: 'A file has the sections "Options", "Errors" and "Rules". The agent writes a new rule about errors.',
      question: 'Where does the unit go?',
      options: {
        rules: 'Under `## Rules`, with the other units',
        errors: 'Under "Errors", next to the text it is about',
        new: 'In a new `## Error rules` section after "Errors"',
      },
      expect: 'rules',
    },
  }, () => {
  const text = `# T\n\n## Rules\n\nSome text.\n\n### fact: f\n\nWhen: x\n\nValue: y\n\n#### Notes\n\n## More\n\n## Rules\n`;
  expect(structureOf(text).sort()).toEqual([
    '13 - error: `## Rules` holds only units; `#### Notes` is not one',
    '15 - error: `## Rules` is the last section of the file; move `## More` above it',
    '17 - error: a second `## Rules`; a file has one, holding all its units',
    '5 - error: `## Rules` holds only units; move this text above `## Rules` or into a unit',
  ]);
});

unit('language-on-every-example', { when: 'the agent writes a fenced block under `Right` or a path of `Decide`.', do: 'name its language after the opening fence, such as `ts`, `sh` or `yaml`.' }, () => {
  const text = `# T\n\n${F}\noutput\n${F}\n\n## Rules\n\n### rule: r\n\nWhen: x\n\nDo: y\n\nRight:\n\n${F}\ntf.get('/a');\n${F}\n\n### decision: d\n\nWhen: x\n\nDecide:\n\n- **a** — y\n\n  ${F}\n  tf.post('/a');\n  ${F}\n`;
  expect(structureOf(text)).toEqual([
    '17 r error: this example has no language after its opening fence (`ts`, `sh`…), so nothing checks it',
    '29 d error: this example has no language after its opening fence (`ts`, `sh`…), so nothing checks it',
  ]);
});
