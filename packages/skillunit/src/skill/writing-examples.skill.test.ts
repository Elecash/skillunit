// The file `writing/examples.md` of the skill: its `setup()`, then its units in the order the file shows them.
import { setup, unit } from 'skillunit/vitest';
import { describe } from 'vitest';

setup('writing-examples', {
  file: 'writing/examples.md',
  title: 'SkillUnit — code in a unit',
  when: 'Show code in a unit, with a region of its test',
  description: 'How the code an agent copies from a skill comes from the tests.',
});

describe('writing/examples.md', () => {
  unit('region-or-example', {
    when: 'a unit should show an example.',
    decide: 'where the example comes from.',
    paths: [
      {
        path: 'region',
        when: 'the example is code: put it between a `// #region skill:<id>` line and a `// #endregion` line in the test file of the unit. A path of a decision takes the region `skill:<id>.<path>`, and another example of a rule or a fact `skill:<id>.<name>`.',
      },
      { path: 'example', when: 'the example is something the test produced, such as an output or a settings file: pass it to `u.example(lang, text)` in the body.' },
    ],
    evenWhen: 'the unit has no body; put its region in a function the test file exports and never calls, so the type-check of the project covers it and nothing runs it.',
    ask: {
      id: 'example-is-a-value',
      scenario: `A unit's example is the JSON configuration that a test builds and checks in its body.`,
      question: 'How should the test hand that example to the skill?',
      options: {
        example: "Pass it to `u.example('json', text)` in the body",
        region: 'Put the JSON between `#region` and `#endregion` comments in the test',
        paste: 'Paste the JSON into the skill by hand after the test passes',
      },
      expect: 'example',
    },
  });

  unit('complete-examples', {
    when: 'the agent writes the code of a region.',
    do: 'make it compile on its own: declare in the region every name it uses, or import it in the region `skill:<setup id>` at the top of the test file.',
    ask: {
      id: 'undefined-name',
      scenario: 'The code of a region calls `api.get("users")`, and `api` is declared by the test, above the region.',
      question: 'What should the agent do?',
      options: {
        declare: 'Declare `api` in the region, or import it in the region at the top of the test file',
        leave: 'Leave it: the test declares `api`, so the region compiles',
        comment: 'Add a comment in the region that says what `api` is',
      },
      expect: 'declare',
    },
  });

  unit('region-holds-library-code', {
    when: 'the agent decides what goes inside a region.',
    do: 'put in it only code a user of the library would write; keep the helpers, fixtures and assertions of the test outside it.',
    evenWhen: 'a helper of the test makes the region shorter; the agent copies the region, helper and all, and the helper does not exist in its project.',
    ask: {
      id: 'helper-in-region',
      scenario: 'The test of a unit starts a fake server with `serve()`, a helper of the test file, then calls the library. The agent marks the region.',
      question: 'What should the region hold?',
      options: {
        library: 'The call to the library alone',
        both: 'The call to `serve()` and the call to the library, so the example runs as it is',
        all: 'The whole body of the test',
      },
      expect: 'library',
    },
  });

  unit('type-check-the-tests', {
    when: 'a project declares units in its tests.',
    do: 'make the type-check of the project, such as `tsc --noEmit`, cover the test files that declare units; Vitest runs a test file without checking its types.',
    evenWhen: 'the tests pass; a region in a function nothing calls passes them with a call the library no longer has.',
    ask: {
      id: 'typecheck-tests',
      scenario: 'A project runs `tsc --noEmit -p tsconfig.build.json` in CI, and that config leaves out `*.test.ts`. Its tests declare units with regions.',
      question: 'What should the agent change?',
      options: {
        cover: 'Make a type-check cover the test files too',
        nothing: 'Nothing; Vitest compiles the tests when it runs them',
        move: 'Move the regions out of the test files',
      },
      expect: 'cover',
    },
  });
});
