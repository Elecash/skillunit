# SkillUnit — files and the index

How a skill is split into files, how an agent finds the right one, and what goes in prose and what in a unit.

A skill is a tree an agent walks by task. `SKILL.md` says what the library is, holds the units every task meets, and has a "Where to look" table from task to file. Each other file covers one thing (a widget, a feature, a host) and is named after it, such as `widgets/calendar.md` or `features/i18n.md`. To translate a calendar, an agent reads `widgets/calendar.md`, then `features/i18n.md`.

Small files keep each request to the decision model small, let an agent load only what its task needs, and let `test --changed` ask only the questions about the files that changed.

## Layout of a file

````md
# tinyfetch — retries

One to three lines: what this file covers.

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

{{unit:one-task-per-file}}

{{unit:index-every-file}}

{{unit:rules-section-last}}

{{unit:instructions-only-in-units}}
