# SkillUnit — files and the index

How a skill is split into files, how an agent finds the right one, and what goes in prose and what in a unit.

A skill is a tree an agent walks by task. `SKILL.md` says what the library is, holds the units every task meets, and has a "Where to look" table from task to file. Each other file covers one thing (a widget, a feature, a host) and is named after it, such as `widgets/calendar.md` or `features/i18n.md`. To translate a calendar, an agent reads `widgets/calendar.md`, then `features/i18n.md`.

Lint reports a file that nothing leads to from `SKILL.md`, directly or through other files. A link leads to it, and so does its relative path written in text, in a code span or in a fence with no language or `text`; a path in a `ts` example is code and does not. A bare file name, `strings.md`, leads to it only while no other file of the skill has that name.

Small files keep each request to the decision model small, let an agent load only what its task needs, and let `test --changed` run only the specs of the files that changed. Lint warns about a file above about 300 lines.

## Layout of a file

````md
# tinyfetch — retries

One to three lines: what this file covers.

Setup:

```ts
import { tf } from "tinyfetch";
```

## Options

Explanations, option tables, signatures and examples.

## Rules

Every unit of the file, and nothing else.
````

The reference sections describe how things work. The units decide what the agent does. A unit refers to a reference section by its name ("the table in 'Options'"), and prose refers to a unit by its id (`retry-idempotent-only`).

## Rules

### rule: one-task-per-file

When: a skill grows, or a file covers more than one task.

Do: give each task its own file, named after the thing or feature it covers, and split a file when an agent doing one task needs only part of it.

Even when: the two tasks share a few rules; the shared rule lives in the more specific file, and the other links to it.

Applies: files

### rule: index-every-file

When: the agent adds a file to a skill.

Do: add a row for it to the "Where to look" table of `SKILL.md`, from the task to the file, with a relative link.

Right:

```md
| Retry a request that failed | [features/retries.md](features/retries.md) |
```

Applies: files, index

### rule: rules-section-last

When: the agent writes the units of a file.

Do: put every unit under one `## Rules` heading, the last `##` section of the file, with nothing else in it.

Applies: files, units

### rule: instructions-only-in-units

When: a sentence in a reference section tells the agent what to do, or gives an exception to a rule.

Do: write the instruction as a unit, and the exception inside its unit, under `Even when`; the prose only describes.

Even when: the exception is one short clause; the reader follows the most specific rule it finds, so an exception stated before the rule loses to it.

Applies: files, units, exceptions
