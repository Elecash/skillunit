# SkillUnit — writing a question

How to write one question for the decision model: the scenario, the question, the options and what to expect.

A question is a situation (`scenario`), a `question` about it, and either a few `options` with one expected, or none for a yes/no question. The decision model reads the skill text and the question, and gives a probability to each option. SkillUnit adds a `none` option to every question with options: "the skill says something different, or does not settle this". A question passes when the expected answer wins with enough confidence: 0.5 for a question with options, a P(yes) of at least 0.7 for an expected `yes`, at most 0.3 for an expected `no`.

A question goes in the `ask` of its unit, in the test that declares it, or in `ask()` when it is about prose and belongs to no unit:

```ts
unit("retry-idempotent-only", {
  when: "a request may be retried.",
  do: "enable `retry` only for GET, HEAD, PUT and DELETE.",
  ask: {
    id: "post-no-retry", // optional; the unit's id, then <unit id>.2, <unit id>.3
    scenario: "An order is created with `tf.post`.", // or a list of phrasings
    question: "Should the agent pass `retry` to that call?",
    options: { retry: "Pass `retry`", "no-retry": "Leave `retry` off" }, // leave out for a yes/no question
    expect: "no-retry", // an option label or none; yes or no without options
    // with: ["references/a.md"], section: "A heading": optional
  },
});

ask("which-file-for-retries", { file: "SKILL.md", scenario: "…", question: "…", options: ["retries", "errors"], expect: "retries" });
```

These are the only keys. A question with another key, or whose `expect` names no option, fails the test that declares it, with what to fix.

## Rules

### rule: scenario-without-the-answer

When: the agent writes the scenario of a question.

Do: describe the situation as the agent meets it, in the user's words, without the rule or its reason.

Right:

```ts
scenario: 'Production is down after a deploy, and the user has a fix ready.',
```

### rule: ask-about-an-action

When: the agent writes what a question asks.

Do: ask what the agent should do in the situation, never what the text mentions.

Right:

```ts
question: 'What should the agent do first?',
```

### rule: prefer-choice-questions

When: the agent chooses between a question with options and a yes/no question.

Do: write one with options, and keep yes/no for a decision with exactly two outcomes that common sense would get wrong.

### rule: ask-where-the-rule-allows

When: a rule forbids something in some cases and allows it in others.

Do: add a question about a case the rule allows, and expect the agent to go ahead there.

Right:

```ts
{
  id: 'put-may-retry',
  scenario: 'A settings document is replaced with `tf.put`, and the API sometimes answers 503.',
  question: 'Should the agent pass `retry` to that call?',
  options: {
    retry: 'Yes, `retry` is allowed for this method',
    'no-retry': 'No, leave `retry` off for this method',
  },
  expect: 'retry',
}
```

### rule: ask-where-the-skill-is-silent

When: the skill leaves out a task close to the ones it covers.

Do: write one question about that task with options an agent might stretch the skill to, and expect `none`.

### rule: options-cover-the-rule

When: the agent writes the options of a question.

Do: make each option say everything the skill says on the point, and make the options differ only in what the question checks.

Right:

```ts
options: {
  exact: 'Quote the command in backticks, and ask which command, exactly as written, the skill gives',
  loose: 'Quote the command in backticks, and ask which command the skill gives',
},
```

### rule: tempting-wrong-options

When: the agent writes the wrong options of a question.

Do: use the answers an agent would give if the rule were missing, such as the shortcut, the default, or what the user literally asked for.

### rule: none-is-built-in

When: the agent wants an option that means "other", "none of these" or "the skill does not say".

Do: leave it out: SkillUnit adds `none` to every question with options.

### rule: expect-none-only-for-silence

When: the agent sets `expect` and no option matches what the skill says.

Do: add an option that says what the skill says, and expect it; expect `none` only where the skill should be silent.

### rule: ask-for-exact-values

When: a question checks a value whose spelling matters, such as a command, a file name or a flag.

Do: quote the value in backticks in the options, and ask for it "exactly as written".

### rule: short-option-labels

When: the agent names the options of a question.

Do: label each option with a short lowercase word or two (`stop`, `no-retry`), and put the meaning in its description.

### rule: options-from-the-code

When: an option of a question names a value the code has, such as a default.

Do: build the option from the code in a template string, as the sentence of the unit is, so the question follows the code when the value changes.

Right:

```ts
options: { right: `${DEFAULT_TIMEOUT / 1000} seconds`, longer: `${(3 * DEFAULT_TIMEOUT) / 1000} seconds` },
```
