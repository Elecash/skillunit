// The units of skills-src/skillunit/writing/examples.md that no test proves, and the questions about that
// file. `skillunit proof` puts each unit where the source has `{{unit:<id>}}`. See docs/proof.md.
import { unit } from '../vitest.js';

unit('setup-once-per-file', {
  when: 'the examples of a file need imports or declarations.',
  do: 'write them once, as `Setup:` followed by a fenced block, after the file\'s introduction, before its first example and outside `## Rules`; when most files of the skill need the same ones, write that `Setup` once in `SKILL.md`, which covers every file with no `Setup` of its own. A file that has its own `Setup` uses only that one, so its `Setup` imports again what the file needs from `SKILL.md`\'s.',
  examples: [
    { lang: 'md', text: 'Setup:\n\n```ts\nimport { tf } from "tinyfetch";\n```' },
  ],
  ask: [
    {
      id: 'shared-import',
      scenario: 'Every example of a file uses `tf` from the library.',
      question: 'Where should the import go?',
      options: {
        setup: 'Once, in a `Setup` block before the first example of the file',
        each: 'At the top of every example',
        nowhere: 'Nowhere; the reader knows where `tf` comes from',
      },
      expect: 'setup',
    },
    {
      id: 'setup-in-skill-md',
      scenario: 'Twenty files of a skill have examples, and every one of them uses `tf` from the library.',
      question: 'Where should the import of `tf` go?',
      options: {
        'skill-md': 'Once, in a `Setup` in `SKILL.md`',
        'each-file': 'In a `Setup` in each of the twenty files',
        'each-example': 'At the top of every example',
      },
      expect: 'skill-md',
    },
    {
      id: 'own-setup-repeats',
      scenario: '`SKILL.md` has a `Setup` that imports `tf`. One file also needs `TimeoutError`, so it gets a `Setup` of its own.',
      question: 'What should that file\'s `Setup` import?',
      options: {
        both: 'Both `tf` and `TimeoutError`',
        'only-new': 'Only `TimeoutError`; `tf` comes from `SKILL.md`',
      },
      expect: 'both',
    },
  ],
});

unit('setup-per-version', {
  when: 'a file shows code of another library or of an older version under a name the `Setup` it uses declares, such as the "before" blocks of a migration guide.',
  do: 'give that file a `Setup` of its own that declares the names its examples need, or mark the "before" blocks `no-check`.',
  ask: {
    id: 'migration-guide',
    scenario: '`SKILL.md` has a `Setup` that declares `redis` as the client of version 2. A migration guide with no `Setup` of its own shows version 1 fragments that call `redis.hmset(...)`, which version 1 has and version 2 removed. Lint reports `Property \'hmset\' does not exist` on each of them.',
    question: 'What should the agent do?',
    options: {
      'own-setup': 'Give the migration guide a `Setup` of its own that declares the version 1 client',
      rewrite: 'Update the version 1 fragments to the version 2 API, so that lint passes',
      report: 'Leave them and report the findings as examples that no longer match the API',
    },
    expect: 'own-setup',
  },
});

unit('complete-examples', {
  when: 'the agent writes an example.',
  do: 'make it compile on its own after the file\'s `Setup`: declare every name it uses, in the block or in `Setup`.',
  ask: {
    id: 'undefined-name',
    scenario: 'An example calls `api.get("users")`, and nothing in the file declares `api`.',
    question: 'What should the agent do?',
    options: {
      declare: 'Declare `api` in the example or in `Setup`, so the example compiles',
      'no-check': 'Mark the block `no-check`',
      leave: 'Leave it; readers can guess what `api` is',
    },
    expect: 'declare',
  },
});

unit('short-complete-examples', {
  when: 'an example would need more code than the point it makes.',
  do: 'declare what every example assumes in `Setup`, stand-in values included, without a body (`declare const user: User;`); leave a part out with a comment such as `// handle the other cases`; show only the call the rule is about.',
  examples: [
    { lang: 'md', text: 'Setup:\n\n```ts\nimport { tf } from "tinyfetch";\n\ninterface Order { id: number; item: number }\ndeclare const draft: { item: number };\n```\n\n```ts\nconst order = await tf.post<Order>("https://api.example.com/orders", draft);\n```' },
  ],
  ask: [
    {
      id: 'leave-a-part-out',
      scenario: 'An example\'s `catch` block would need ten lines that have nothing to do with the rule it shows.',
      question: 'How should the agent leave those lines out?',
      options: {
        comment: 'A comment such as `// handle the other cases` in their place',
        dots: 'Three dots in their place',
        'no-check': 'Keep the lines out and mark the block `no-check`',
      },
      expect: 'comment',
    },
    {
      id: 'stand-in-value',
      scenario: 'Every example of a file sends a `user` object the reader is meant to already have.',
      question: 'Where should `user` come from?',
      options: {
        setup: 'A declaration without a body in `Setup`, such as `declare const user: User;`',
        each: 'A full object literal at the top of each example',
        nowhere: 'Nowhere; the reader knows what `user` is',
      },
      expect: 'setup',
    },
  ],
});

unit('signatures-in-tables', {
  when: 'the agent shows a signature or the shape of an object rather than code to copy.',
  do: 'put it in a table or in inline code, or mark its fence `no-check` after the language.',
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

unit('no-check-rarely', {
  when: 'a block cannot compile on purpose, such as a fragment that shows one line of a larger file.',
  do: 'mark it `no-check` after the language (`ts no-check`), and only that block.',
  evenWhen: 'many blocks fail after a change to the library; fix them, since that failure is what lint is for.',
  ask: {
    id: 'stale-blocks',
    scenario: 'After a library change, five examples of the skill no longer compile.',
    question: 'What should the agent do?',
    options: {
      fix: 'Fix the five examples',
      'no-check': 'Mark the five blocks `no-check`',
      delete: 'Delete the five examples',
    },
    expect: 'fix',
  },
});
