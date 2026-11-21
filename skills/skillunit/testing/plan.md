# SkillUnit — planning the specs

Which specs a skill needs, what each one sends to the decision model, and how a test is tied to its unit.

A spec is a YAML file of tests about one file of the skill. The test layer sends that file (or some of its headings, with `section`) to the decision model as the state, and asks each test as a closed question about it. A spec with `with` also sends other files of the skill, the ones an agent reads together with it. Each spec is one request, whatever the number of tests in it.

A test that names its unit with `unit:` runs with `test --changed` when sync reports that unit as stale or new. A spec runs whole with `test --changed` when its file, or a file in its `with`, changed.

## Rules

### rule: one-spec-per-file

When: the agent plans the specs of a skill.

Do: give every file of the skill its own spec, named after it, with `file` set to its path, so a rule is tested in the file that states it.

Right:

```yaml
file: features/retries.md
tests:
  - id: post-no-retry
    unit: retry-idempotent-only
    scenario: An order is created with `tf.post`, and the network drops now and then.
    question: Should the agent pass `retry` to that call?
    options:
      retry: Yes, pass `retry` so the request survives a dropped connection
      no-retry: No, leave `retry` off for this method
    expect: no-retry
```

Wrong:

- Doing: testing every rule through `SKILL.md`, with every other file in `with: all`.

  Because: each request then carries the whole skill, the answers get less precise, and a failure does not say which file to fix.

Applies: specs, planning

Source: src/test/spec.ts

### rule: section-for-long-files

When: the file under test is long, above about 3,000 characters.

Do: write one spec per heading with `section` set to it, and one per subheading when a heading is itself longer than that.

Even when: the file is short; then one spec with no `section` covers it whole.

Wrong:

- Doing: one spec whose `section` lists every heading of a long file.

  Because: the request is as large as the whole file, so nothing is gained.

Applies: specs, planning

Source: src/test/skill-text.ts

### rule: with-only-what-the-agent-reads

When: a rule reaches the agent from more than one file, and a mistake costs a lot.

Do: add a spec whose `with` lists the files the agent reads for the task its tests describe, and keep the spec without `with` too.

Wrong:

- Doing: `with: all` in a skill of many files.

  Because: text the agent never reads makes the answers less certain, and a file the agent never opens can settle a test it would get wrong.

Applies: specs, planning

Source: src/test/skill-text.ts

### rule: list-the-decisions-first

When: the agent is about to write the tests of a file.

Do: list the decisions the file forces, the places where an agent that read it acts differently from one that did not, and show the list to the user when they have not said which parts matter.

Even when: the file looks small; a sentence that changes nothing an agent does gets no test.

Wrong:

- Doing: a test for every sentence of the file.

  Because: tests of sentences that change nothing pass on any version of the skill and only look like protection.

Applies: specs, planning

Source: src/test/spec.ts

### rule: link-tests-to-units

When: a test is about one unit.

Do: give it `unit:` with the unit's id.

Wrong:

- Doing: leaving `unit:` out of every test.

  Because: `test --changed` then cannot run the tests of a unit whose code changed, and runs only specs whose file changed.

Applies: specs, changed

Source: src/test/changed.ts
