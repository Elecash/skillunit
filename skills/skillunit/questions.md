# SkillUnit — questions for the decision model

How a test declares a question, what the model reads to answer it, and how its answer is judged.

## Rules

### fact: question-spec

When: a test declares a question for the decision model.

Value: a unit asks with `ask` in its spec, one question or a list. `ask(id, spec)` asks about the prose of a built file: the one named in `file`, else the file of its `setup()`, else `SKILL.md`. A question takes `id`, `scenario`, `question`, `options`, `expect`, `with` and `section`. With `options`, SkillUnit adds `none`, which `expect` may name and `options` may not list; with no `options`, `expect` is `yes` or `no`.

### fact: how-a-question-passes

When: a verdict is read, or a threshold is chosen.

Value: a question with `options` passes when the expected option has the highest probability, and that probability is at least `choice`, 0.5 by default; a tie at the top never passes. A yes or no question passes when P(yes) is at least `yes`, 0.7, for `yes`, or at most `no`, 0.3, for `no`.

### fact: phrasings

When: a question gives `scenario` as a list of phrasings.

Value: each phrasing is asked on its own, and the question passes when most of them pass, so no single wording decides it.

### fact: borderline

When: a verdict is close to its threshold.

Value: a verdict within `margin`, 0.13 by default, of its threshold is marked borderline: the next run may decide it the other way. A borderline pass still passes.

### fact: what-the-model-reads

When: a question is asked, or fails and the skill has to change.

Value: the model reads the built file that holds the question's unit, or the file of `ask()`: whole, or cut to the headings of `section`. It reads the files of `with` too, or every other file with `with: all`, and the `context` of the settings. It never reads the tests. One request carries every question about the same file, `section` and `with`.

### fact: question-not-asked

When: a question is missing from the verdicts.

Value: a question is not asked, and the report says why, when the skill folder does not have its unit yet (run `proof --write`), when the test of its unit failed or when its file is not in the skill folder.

### fact: request-limits

When: a file of the skill is large, or many questions are about it.

Value: a request larger than the model takes is not sent: the report says so, and names the largest parts. Questions with another `section` go in a request of their own, so a large file can be asked about in parts.

### rule: when-to-ask

When: a test decides whether a unit gets a question.

Do: give a question to a rule or a decision an agent would plausibly get wrong, and to a fact whose sentence leaves something to work out: two values to combine, an exception to apply. A fact that states one value from the code gets no question.

Even when: the user asks for a question on every unit: a question about one value passes without its unit, or fails on a wording, and proves nothing either way.

### rule: scenario-pulls

When: a test writes the scenario and the options of a question.

Do: write the scenario so that it pulls toward the wrong answer: the user asks for what the rule forbids, or the shortcut is in plain sight. The wrong options are the answers an agent gives without the unit.

Even when: a plain scenario reads better: common sense then passes the question, and it passes without its unit too.

### rule: no-sums-no-absence

When: a question would have the reader work out a number, or decide that something does not exist.

Do: do not ask the reader to add numbers up, or to conclude from a list that what it leaves out does not exist. When the skill must say that something is not there, a fact says it in so many words, in `unknown`.

Even when: the list is complete: shown "these options and no other", a reader still does not say that an option is missing.

### rule: copy-check

When: a question passes, and the test should show that its unit is what makes it pass.

Do: delete the text of the unit in a copy of the skill folder, keep its heading, and ask with `test --skill <copy>`. A question that still passes goes, or its unit changes; never change a threshold to keep it.

Even when: the question passes with its unit: that says nothing about whether the unit is what answers it.
