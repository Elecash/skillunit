# SkillUnit — writing a test

How to write one test: the scenario, the question, the options and what to expect.

A test is a situation (`scenario`), a `question` about it, and either a few `options` with one expected, or none for a yes/no question. The decision model reads the skill text and the question, and gives a probability to each option. SkillUnit adds a `none` option to every choice test: "the skill says something different, or does not settle this". A test passes when the expected answer wins with enough confidence: 0.5 for a choice, a P(yes) of at least 0.7 for an expected `yes`, at most 0.3 for an expected `no`.

```yaml
file: SKILL.md              # optional; SKILL.md by default
section: A heading          # or a list of headings; leave out for the whole file
with: [references/a.md]     # optional; other files the agent reads too, or all
tests:
  - id: kebab-case-id
    unit: some-unit-id      # optional; the unit the test is about
    scenario: The situation.            # or a list of phrasings
    question: What should the agent do?
    options:                            # leave out for a yes/no test
      label: What this answer means
    expect: label                       # an option label or none; yes or no without options
```

These are the only keys; any other key stops the spec from loading.

## Rules

### rule: scenario-without-the-answer

When: the agent writes the scenario of a test.

Do: describe the situation as the agent meets it, in the user's words, without the rule or its reason.

Right:

```yaml
scenario: Production is down after a deploy, and the user has a fix ready.
```

Applies: tests, scenario

### rule: ask-about-an-action

When: the agent writes the question of a test.

Do: ask what the agent should do in the situation, never what the text mentions.

Right:

```yaml
question: What should the agent do first?
```

Applies: tests, question

### rule: prefer-choice-tests

When: the agent chooses between a choice test and a yes/no test.

Do: write a choice test, and keep yes/no for a decision with exactly two outcomes that common sense would get wrong.

Applies: tests, options

### rule: test-where-the-rule-allows

When: a rule forbids something in some cases and allows it in others.

Do: add a test for a case the rule allows, and expect the agent to go ahead there.

Right:

```yaml
- id: put-may-retry
  scenario: A settings document is replaced with `tf.put`, and the API sometimes answers 503.
  question: Should the agent pass `retry` to that call?
  options:
    retry: Yes, `retry` is allowed for this method
    no-retry: No, leave `retry` off for this method
  expect: retry
```

Applies: tests, coverage

### rule: test-where-the-skill-is-silent

When: the skill leaves out a task close to the ones it covers.

Do: write one test about that task with options an agent might stretch the skill to, and expect `none`.

Applies: tests, coverage

### rule: options-cover-the-rule

When: the agent writes the options of a test.

Do: make each option say everything the skill says on the point, and make the options differ only in what the test checks.

Right:

```yaml
options:
  exact: "Quote the command in backticks, and ask which command, exactly as written, the skill gives"
  loose: "Quote the command in backticks, and ask which command the skill gives"
```

Applies: tests, options

### rule: tempting-wrong-options

When: the agent writes the wrong options of a test.

Do: use the answers an agent would give if the rule were missing, such as the shortcut, the default, or what the user literally asked for.

Applies: tests, options

### rule: none-is-built-in

When: the agent wants an option that means "other", "none of these" or "the skill does not say".

Do: leave it out: SkillUnit adds `none` to every choice test.

Applies: tests, options

### rule: expect-none-only-for-silence

When: the agent sets `expect` and no option matches what the skill says.

Do: add an option that says what the skill says, and expect it; expect `none` only where the skill should be silent.

Applies: tests, options

### rule: ask-for-exact-values

When: a test checks a value whose spelling matters, such as a command, a file name or a flag.

Do: quote the value in backticks in the options, and ask for it "exactly as written".

Applies: tests, options

### rule: short-option-labels

When: the agent names the options of a test.

Do: label each option with a short lowercase word or two (`stop`, `no-retry`), and put the meaning in its description.

Applies: tests, options

### rule: quote-yaml-values

When: a value in a spec contains `: `, or starts with a backtick, `{` or `[`.

Do: put the value in double quotes, or in single quotes when it also contains double quotes.

Right:

```yaml
cast: "Cast the error to `{ status: number }`"
```

Applies: tests, yaml
