# SkillUnit — units

How to declare a unit with `unit()`, and how its text follows the code.

```ts
import { unit } from 'skillunit/vitest';
import { expect } from 'vitest';
import { DEFAULT_RETRY_DELAY, RETRY_TIMES, retryWaits } from './retry.js';
```

## Rules

### decision: pick-a-kind

When: the agent turns an instruction of the skill into a unit.

Decide: which kind of unit to write.

- **rule** — a constraint on what the agent writes or does: `do`.

- **decision** — the agent chooses between paths that depend on the situation: `paths`, one `{ path, when }` for each, and `decide` for what is chosen.

- **fact** — a value the agent must state exactly, such as a default or a limit: `value`, and `unknown` for what the value does not cover.

Even when: a rule seems to need two `do` sentences; that is two rules, or a decision.

### fact: spec-keys

When: the agent writes the spec of a `unit()`.

Value: a spec takes `when`, `do`, `value`, `decide`, `paths`, `unknown`, `evenWhen`, `values`, `ask` and `examples`: `when` always, and `do` for a rule, `value` for a fact, or `decide` and `paths` for a decision; `unknown` goes with a fact, `evenWhen` with a rule or a decision, and `examples` with a rule or a fact; any other key fails the test that declares the unit.

### rule: id-names-the-instruction

When: the agent names a unit.

Do: use a kebab-case id that names the instruction, such as `retry-idempotent-only`, unique across the units and the `setup()` of the skill.

### rule: declare-in-the-test-that-checks-it

When: a unit states what the code does: a default, which inputs it takes, what it returns or throws.

Do: declare the unit with `unit()` around the test that asserts what it states, in the test file of its file of the skill, run `npx skillunit proof --write`, and commit the test and the built skill together.

Even when: a test on the same topic already exists; wrap it only if it asserts what the unit says.

### rule: build-the-sentence-from-the-code

When: a unit in a test states a value that defines behaviour, such as a default, a limit or how a wait grows.

Do: give the value a name in the code, such as `RETRY_TIMES`; use that name in the code and in the assertion of the test, build the sentence from it in a template string, and list it in `values`. Type no number into the sentence, and no word that stands for one, such as "doubled", "twice" or "half".

Even when: the code has the value only as a literal in an expression: give it a name in the code first, then write the unit. `unit()` fails a unit with a body when its text has a number that none of its `values` is.

Right:

```ts
unit(
  'retry-delay',
  {
    when: 'a request sets `retry` and no `retryDelay`.',
    value: `the first new attempt waits ${DEFAULT_RETRY_DELAY} ms, and each next wait is ${RETRY_TIMES}x the one before.`,
    values: { delay: DEFAULT_RETRY_DELAY, times: RETRY_TIMES },
  },
  () => {
    expect(retryWaits(2)).toEqual([DEFAULT_RETRY_DELAY, RETRY_TIMES * DEFAULT_RETRY_DELAY]);
  },
);
```

### rule: unit-without-a-body

When: what a unit says is advice that no test of the code can check, such as how to name things or when to ask the user.

Do: declare it with `unit()` and no body, and give it a question in `ask`, which is all that checks it; keep such units the exception, since a unit that states what the code does has a test.

Even when: a test would be hard to write; a unit with no body can stop being true without any test failing.

### fact: other-test-runners

When: the project tests its code with a runner other than Vitest.

Value: declare the files, units and questions with `createUnit` from `skillunit/unit`, given the runner's `it`, or have the tests write their records, at version 2 of the contract.
