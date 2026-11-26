---
name: skillunit
description: Write an agent skill from the tests of the code it describes, and check that it still says what the code does, with SkillUnit. Use when asked to write or restructure a skill, to add or fix the tests that declare its files, units and questions, or to check that a skill still says what it should after the code changed.
---

# SkillUnit

SkillUnit builds an agent skill from the tests of the code it describes, and asks a decision model closed questions about what the skill says.

```ts
import { ask, setup, unit } from 'skillunit/vitest';
```

## Where to look

| Task | File |
| --- | --- |
| Decide which questions a skill needs, and where each one goes | [testing/plan.md](testing/plan.md) |
| Build the skill with `proof --write`, and act on what proof reports | [testing/proof.md](testing/proof.md) |
| Run the checks, read a report, act on a failed question | [testing/results.md](testing/results.md) |
| Write a question: scenario, question, options, the keys of `ask` | [testing/tests.md](testing/tests.md) |
| Show code in a unit, with a region of its test | [writing/examples.md](writing/examples.md) |
| Split a skill into files, and declare each one with `setup()` | [writing/files.md](writing/files.md) |
| Write a unit in the test that checks it: its kind, its text and its values | [writing/units.md](writing/units.md) |

## Rules

### rule: init-first

When: a project has a skill, or code that needs one, and no `skillunit.yaml`.

Do: run `npx skillunit init <skill folder>` from the project root and set `context` to one sentence about what the skill is for; then declare each file of the skill with `setup()` and each unit with `unit()` in the tests, set `proof.run` to the command that runs those tests, and run `npx skillunit proof --write`.

Right:

```yaml
# SkillUnit settings. Reference: https://github.com/Elecash/skillunit#readme
skill: ./skills/my-skill        # folder with SKILL.md
# context: "One sentence about what the skill is for."
# To build the skill from the files and units your tests declare:
# proof: { run: "npx vitest run skill.test" }   # the test files that declare them: *.skill.test.ts
```

### rule: key-outside-the-repo

When: the test layer needs the decision model's API key.

Do: put the key of the provider `skillunit.yaml` names, `TYPESAFE_API_KEY` or `OPENAI_API_KEY`, in the environment (a secret in CI), or in a `.env` file that git ignores, next to `skillunit.yaml` or at the root of the repository; never in `skillunit.yaml` itself.

Right:

```sh
echo "TYPESAFE_API_KEY=your-key" >> .env
```

### rule: dry-run-without-key

When: there is no API key, and the user asked for tests.

Do: write the questions anyway, run `npx skillunit check --dry-run`, and tell the user they were not sent to the model.

Even when: the questions look obviously right; a question that was never sent has not passed.

Right:

```sh
npx skillunit check --dry-run
```

### decision: which-command

When: the agent has changed a skill, its questions or the code it describes, and wants to know if the skill still holds.

Decide: which layer to run.

- **proof** — the code changed, or its tests did: `npx skillunit proof`, which runs the tests and names each unit the change moved.

- **test** — what a unit says changed, or its questions did: `npx skillunit test`, or `npx skillunit test --changed` for only the questions about the files those changes touch.

- **check** — before handing the work over: `npx skillunit check`, both layers in one run.

Even when: only one file changed; `check` is what CI runs, so it is the last command before handing over.
