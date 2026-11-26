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

Value: a question is not asked, and the report says why, when the skill folder does not have its unit yet (run `proof --write`), when the test of its unit failed, or when its file is not in the skill folder.

### fact: request-limits

When: a file of the skill is large, or many questions are about it.

Value: a request larger than the model takes is not sent: the report says so, and names the largest parts. Questions with another `section` go in a request of their own, so a large file can be asked about in parts.
