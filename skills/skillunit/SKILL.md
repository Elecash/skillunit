---
name: skillunit
description: Write an agent skill in units and check that it still says what the code it describes does, with SkillUnit. Use when asked to write or restructure a skill, to add or fix SkillUnit tests (specs), or to check that a skill still says what it should after the code changed.
---

# SkillUnit

SkillUnit checks that an agent skill still says what the code it describes does. A skill is written as small Markdown files whose instructions are units: a `### rule:`, `### decision:` or `### fact:` heading followed by labelled paragraphs. Three layers check it:

| Layer | Command | What it finds | Needs the API key |
| --- | --- | --- | --- |
| lint | `npx skillunit lint` | a malformed unit, an example that does not compile or breaks a rule, a broken link | no |
| proof | `npx skillunit proof` | a unit whose test failed, a block that differs from the example its test produced, a unit no test proves | no |
| test | `npx skillunit test` | text that does not settle a decision: closed questions to a decision model, from YAML specs | yes |

`npx skillunit check` runs all three; it is what CI runs. Proof reads the JUnit report of the project's test run, so the tests run before it. With `--dry-run`, the test layer checks that the specs load and fit, and sends nothing.

The settings live in `skillunit.yaml`, next to the skill or at the root of the project. The decision model's key is `TYPESAFE_API_KEY`. SkillUnit reads it from the environment, or from a `.env` file next to `skillunit.yaml` or in a folder above it, up to the root of the git repository.

## Where to look

| Task | File |
| --- | --- |
| Split a skill into files, write its index, decide what goes in prose and what in a unit | [writing/files.md](writing/files.md) |
| Write a unit: kinds, labels, `Check` | [writing/units.md](writing/units.md) |
| Write code examples that lint can check: `Setup`, `no-check` | [writing/examples.md](writing/examples.md) |
| Decide which specs a skill needs | [testing/plan.md](testing/plan.md) |
| Write a test: scenario, question, options, the spec format | [testing/tests.md](testing/tests.md) |
| Run the checks, read a report, act on a failure | [testing/results.md](testing/results.md) |
| Prove a unit with a test of the code: the `[skill:<id>]` tag, an example a test produces, `Proof: none` | [testing/proof.md](testing/proof.md) |

## Rules

### rule: init-first

When: a project has a skill but no `skillunit.yaml`.

Do: run `npx skillunit init <skill folder>` from the project root, then set `context` in the new `skillunit.yaml` to one sentence about what the skill is for.

Right:

```sh
npx skillunit init skills/my-skill
```

Applies: setup

Proof: none, advice on how to start

### rule: key-outside-the-repo

When: the test layer needs the decision model's API key.

Do: put `TYPESAFE_API_KEY` in the environment (a secret in CI), or in a `.env` file that git ignores, next to `skillunit.yaml` or at the root of the repository.

Right:

```sh
echo "TYPESAFE_API_KEY=your-key" >> .env
```

Applies: setup, keys

Check: forbid `/TYPESAFE_API_KEY:\s*\S/` in yaml

### rule: dry-run-without-key

When: there is no API key, and the user asked for tests.

Do: write the specs anyway, run `npx skillunit check --dry-run`, and tell the user the tests were not sent to the model.

Even when: the specs look obviously right; a test that was never sent has not passed.

Right:

```sh
npx skillunit check --dry-run
```

Applies: setup, test

### decision: which-command

When: the agent has changed a skill, its specs or the code it describes, and wants to know if the skill still holds.

Decide: which layer to run.

- **lint** — the skill's files changed: `npx skillunit lint`.

- **proof** — the code changed, or its tests did: run the tests, then `npx skillunit proof`, which names the units whose tests fail.

- **test** — what a unit says changed, or its specs did: `npx skillunit test`, or `npx skillunit test --changed` for only the specs those changes touch.

- **check** — before handing the work over: `npx skillunit check`, every layer in one run.

Even when: only one file changed; `check` is what CI runs, so it is the last command before handing over.

Applies: commands

Proof: none, advice on which command to run
