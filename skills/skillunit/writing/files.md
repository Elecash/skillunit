# SkillUnit — the files of a skill

How a skill is split into files, and how its tests declare each one.

## Rules

### rule: declare-each-file-with-setup

When: the agent adds a file to a skill, or starts the tests of one.

Do: declare the file with one `setup()` at the top of its test file, before its units: `file` is its path in the skill folder, `title`, `when` and `description` are one line each, and `SKILL.md` takes `frontmatter` in place of `when`.

Even when: the file has no unit yet; the build writes only the files a `setup()` declares.

Right:

```ts
setup('retries', {
  file: 'features/retries.md',
  title: 'tinyfetch — retries',
  when: 'Retry a request that failed',
  description: 'Which failed requests tinyfetch repeats, and how long it waits between attempts.',
});
```

### fact: what-setup-writes

When: the agent fills in the keys of a `setup()`.

Value: `title` is the heading of the file, `description` the line under it, and the region `skill:<setup id>` of its test file the code under that line; `when` is the row of the file in the "Where to look" table of `SKILL.md`, which lists every other file; `frontmatter` is the `name` and `description` an agent reads to pick the skill.

### rule: one-test-file-per-skill-file

When: the agent decides where the `setup()` and the units of a file of the skill go.

Do: put them in one test file of their own, named after the file of the skill, such as `retries.skill.test.ts` for `features/retries.md`.

Even when: the test that checks a unit is in another file; move that test into this file with its unit, and the fixtures it needs into a module both files import.

### rule: behaviour-in-a-unit

When: the agent writes the `description` of a file, or wants to say what the code does outside a unit.

Do: keep the `description` to what the file covers; write each sentence about what the code does, and each instruction, as a unit with a test, and an exception to a rule under its `evenWhen`.

Even when: the sentence fits on the line; no test checks the text of a `setup()`, so a sentence there stops being true without failing anything.
