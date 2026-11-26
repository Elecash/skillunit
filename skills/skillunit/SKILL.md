---
name: skillunit
description: Write and maintain an agent skill that SkillUnit builds from tests. Use when a project has skillunit.yaml, when its tests call setup(), unit() or ask() from skillunit, or when the user asks to add SkillUnit to a project.
---

# SkillUnit

SkillUnit builds an agent skill from the tests of the code it describes, and checks that the skill still says what the code does.

```ts
import { ask, setup, unit } from 'skillunit/vitest';
```

## Where to look

| Task | File |
| --- | --- |
| Build the skill, check it, or read what a check reports | [checking.md](checking.md) |
| Add or fix a question for the decision model | [questions.md](questions.md) |
| Add SkillUnit to a project, or change its settings | [setup.md](setup.md) |
| Declare a file or a unit of the skill in a test | [units.md](units.md) |

## Rules

### rule: skill-folder-is-built

When: a line of the skill folder is wrong, or a unit has to change.

Do: change the test that declares the line, then run `skillunit proof --write`; never edit a file of the skill folder by hand.

Even when: the change is one word: the next `proof` reports the edit, and `--write` puts the built line back.

### fact: commands

When: an agent runs `skillunit`.

Value: `skillunit init` writes `skillunit.yaml`. `skillunit proof` runs the tests that declare the skill, builds the skill from what they declare and compares it with the skill folder. `skillunit test` runs those tests and asks the decision model their questions about the skill folder. `skillunit check` runs `proof`, then `test`.
