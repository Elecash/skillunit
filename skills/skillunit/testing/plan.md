# SkillUnit — planning the specs

Which specs a skill needs, what each one sends to the decision model, and how a test is tied to its unit.

A spec is a YAML file of tests about one file of the skill. The test layer sends that file (or some of its headings, with `section`) to the decision model as the state, and asks each test as a closed question about it. A spec with `with` also sends other files of the skill, the ones an agent reads together with it. Each spec is one request, whatever the number of tests in it.

A test names its unit with `unit:`, and a failure shows it. A spec runs with `test --changed` when its file, or a file in its `with`, changed.

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

Applies: specs, planning

Proof: none, advice on planning specs

### rule: section-for-long-files

When: the file under test is long, above about 3,000 characters.

Do: write one spec per heading with `section` set to it, and one per subheading when a heading is itself longer than that.

Even when: the file is short; then one spec with no `section` covers it whole.

Applies: specs, planning

Proof: none, advice on planning specs

### rule: with-only-what-the-agent-reads

When: a rule reaches the agent from more than one file, and a mistake costs a lot.

Do: add a spec whose `with` lists the files the agent reads for the task its tests describe, and keep the spec without `with` too.

Applies: specs, planning

Proof: none, advice on planning specs

### rule: list-the-decisions-first

When: the agent is about to write the tests of a file.

Do: list the decisions the file forces, the places where an agent that read it acts differently from one that did not, and show the list to the user when they have not said which parts matter.

Even when: the file looks small; a sentence that changes nothing an agent does gets no test.

Applies: specs, planning

Proof: none, advice on planning specs
