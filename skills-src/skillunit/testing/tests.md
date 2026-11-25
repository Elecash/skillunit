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

{{unit:scenario-without-the-answer}}

{{unit:ask-about-an-action}}

{{unit:prefer-choice-questions}}

{{unit:ask-where-the-rule-allows}}

{{unit:ask-where-the-skill-is-silent}}

{{unit:options-cover-the-rule}}

{{unit:tempting-wrong-options}}

{{unit:none-is-built-in}}

{{unit:expect-none-only-for-silence}}

{{unit:ask-for-exact-values}}

{{unit:short-option-labels}}

{{unit:options-from-the-code}}
