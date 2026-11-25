# SkillUnit — planning the questions

Which questions a skill needs, where each one is declared, and what each request sends to the decision model.

A question is declared with its unit, in the `ask` of its `unit()`, and is about the file of the skill that holds the unit; a question about prose that belongs to no unit is declared with `ask()` and names its `file`. The test layer sends that file (or some of its headings, with `section`) to the decision model as the state, and asks each question about it. A question with `with` also sends other files of the skill, the ones an agent reads together with it. The questions about one file, with the same `section` and `with`, go in one request.

A failure shows the unit of the question and the line that declares it. `test --changed` asks the questions about the files that changed, and those whose `with` lists one.

## Rules

### rule: question-with-its-unit

When: the agent writes a question about a rule of the skill.

Do: put it in the `ask` of the rule's `unit()`, where the unit is declared, so it is asked about the file that holds the unit; a question about prose that belongs to no unit goes in `ask()` with its `file`.

Right:

```ts
unit("retry-idempotent-only", {
  when: "a request may be retried.",
  do: "enable `retry` only for GET, HEAD, PUT and DELETE.",
  ask: {
    id: "post-no-retry",
    scenario: "An order is created with `tf.post`, and the network drops now and then.",
    question: "Should the agent pass `retry` to that call?",
    options: {
      retry: "Yes, pass `retry` so the request survives a dropped connection",
      "no-retry": "No, leave `retry` off for this method",
    },
    expect: "no-retry",
  },
});
```

### rule: section-for-long-files

When: the file a question is about is long, above about 3,000 characters.

Do: give the question a `section`, the heading that states its rule, so the request sends only that part; a heading that is itself longer than that takes its subheading.

Even when: the file is short; then a question with no `section` reads it whole.

### rule: with-only-what-the-agent-reads

When: a rule reaches the agent from more than one file, and a mistake costs a lot.

Do: add a question whose `with` lists the files the agent reads for the task it describes, and keep the question without `with` too.

### rule: list-the-decisions-first

When: the agent is about to write the questions of a file.

Do: list the decisions the file forces, the places where an agent that read it acts differently from one that did not, and show the list to the user when they have not said which parts matter.

Even when: the file looks small; a sentence that changes nothing an agent does gets no question.
