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

Even when: the user asks for a question on every unit: a question about one value its test already proves adds only a chance to fail on a wording.

### rule: scenario-pulls

When: a test writes the scenario and the options of a question.

Do: write the scenario so that it pulls toward the wrong answer: the user asks for what the rule forbids, or the shortcut is in plain sight. The wrong options are the answers an agent gives without the unit.

Even when: a plain scenario reads better: common sense then passes the question, whatever the unit says.

### rule: no-sums-no-absence

When: a question would have the reader work out a number, or decide that something does not exist.

Do: do not ask the reader to add numbers up, or to conclude from a list that what it leaves out does not exist. When the skill must say that something is not there, a fact says it in so many words, in `unknown`.

Even when: the list is complete: shown "these options and no other", a reader still does not say that an option is missing.

### rule: when-an-agent-got-it-wrong

When: an agent that used the skill got something wrong, and the skill is to be fixed.

Do: before any change to the skill, write the question that reproduces it: its `scenario` is the situation the agent was in, its wrong `options` are what the agent did, and `expect` is what it should have done. Ask it: it has to fail, or come out borderline. If it passes, the text is clear and the cause is elsewhere: ask that agent why it went wrong, and point the question at what it read, such as the row of the index that should have sent it to the file. Then change the unit until the question passes clear of the threshold, and try the changed skill with an agent on the task that went wrong.

Even when: the fix to the skill is plain: a question written after the fix has never been red, so nothing shows that it reproduces the mistake, and a borderline pass on it means the unit does not say it yet.
