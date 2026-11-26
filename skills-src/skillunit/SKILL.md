---
name: skillunit
description: Write an agent skill in units and check that it still says what the code it describes does, with SkillUnit. Use when asked to write or restructure a skill, to add or fix SkillUnit tests and the questions they declare for the decision model, or to check that a skill still says what it should after the code changed.
---

# SkillUnit

SkillUnit checks that an agent skill still says what the code it describes does. A skill is small Markdown files whose instructions are units: a `### rule:`, `### decision:` or `### fact:` heading followed by labelled paragraphs. In a skill built from a source, each unit is declared in the project's tests with `unit()`, and the source holds the prose and where each unit goes. Two layers check it:

| Layer | Command | What it finds | Needs the API key |
| --- | --- | --- | --- |
| proof | `npx skillunit proof` | a unit whose test failed or is gone, a line of the built skill that is not what the code and its tests give | no |
| test | `npx skillunit test` | text that does not settle a decision: closed questions to a decision model, declared with the units | yes |

`npx skillunit check` runs both; it is what CI runs. Proof runs the project's tests through `proof.run` and builds the skill from `source` and the units the tests declare. With `--dry-run`, the test layer checks that every question can be asked and fits, and sends nothing.

The settings live in `skillunit.yaml`, next to the skill or at the root of the project. The decision model's key belongs to its provider: `TYPESAFE_API_KEY` for `typesafe`, the default, and `OPENAI_API_KEY` for `openai` (`model: { provider: openai }`). SkillUnit reads it from the environment, or from a `.env` file next to `skillunit.yaml` or in a folder above it, up to the root of the git repository.

## Where to look

| Task | File |
| --- | --- |
| Split a skill into files, write its index, decide what goes in prose and what in a unit | [writing/files.md](writing/files.md) |
| Write a unit: kinds and labels | [writing/units.md](writing/units.md) |
| Write code examples | [writing/examples.md](writing/examples.md) |
| Decide which questions a skill needs, and where each one goes | [testing/plan.md](testing/plan.md) |
| Write a question: scenario, question, options, the keys of `ask` | [testing/tests.md](testing/tests.md) |
| Run the checks, read a report, act on a failure | [testing/results.md](testing/results.md) |
| Declare a unit in a test of the code, with `unit()`, and build the skill from its source | [testing/proof.md](testing/proof.md) |

## Rules

{{unit:init-first}}

{{unit:key-outside-the-repo}}

{{unit:dry-run-without-key}}

{{unit:which-command}}
