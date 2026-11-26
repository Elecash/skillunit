# SkillUnit — running the checks and reading a report

How to run the layers, read what they report, and act on a failure.

The default report of `check`, `proof` and `test` lists each file of the skill, each unit in it, and under the unit what each layer found: a `proof` line saying where the unit is declared (`proved by a test` or `declared, no test`, with the file and line) and one for each proof finding, and a `test` line for each of its questions. A line starts with `✓` when it passed, `✗` when it failed, `~` for a warning or a borderline pass, and `–` when that layer has nothing on the unit. A unit that no test proves and that has no question reads `not covered`. The details of a failure are under its line, and `Failed`, at the end, names each failure as `file › unit › line`; `--compact` gives one row per unit. A question that failed shows the scenario, the expected answer, the answer the reader gave and the probability of each option. Exit codes: 0 when every check passed, 1 when one failed, 2 when the command itself was wrong (an unknown option, a missing file, no API key). `--reporter` also takes `json`, `junit` and `github` (annotations on the pull request).

| What the failure shows | What it means |
| --- | --- |
| `none` is high | the reader did not find the rule in the text |
| a wrong option is high | the text points to that answer |
| the expected answer, under the threshold | the text is ambiguous |

A verdict is borderline when the number that decided it is within `thresholds.margin` (0.13 by default) of its threshold. Answers move a little between runs, so a borderline question is the one most likely to change verdict next time. A borderline pass still passes.

## Rules

### rule: dry-run-first

When: the agent has written or changed questions.

Do: run `npx skillunit test --dry-run` and fix what it reports before the real run.

Right:

```sh
npx skillunit test --dry-run
```

### rule: prove-on-a-copy

When: the agent wants to show that a question depends on its rule.

Do: copy the skill folder, delete the rule's sentence in the copy, and run `npx skillunit test --skill <copy>`; the question must fail.

Right:

```sh
cp -R skills/my-skill /tmp/my-skill-copy
npx skillunit test --skill /tmp/my-skill-copy
```

### rule: still-green-without-the-rule

When: a question still passes on a copy with its rule deleted.

Do: look for the cause in this order: an option gives the answer away, the scenario contains the answer, the skill states the rule somewhere else, the reader knows the answer without the skill; fix the question in the first two cases, and tell the user in the last two.

### fact: no-mutations

When: the user asks for mutation testing of the questions.

Value: SkillUnit has no mutations; deleting a rule's sentence in a copy and asking the questions about the copy (see `prove-on-a-copy`) does the same job.

Unknown: there is no mutation setting or tool; say so instead of adding one to the questions.

### rule: report-dont-bend

When: a question fails on the unmodified skill, and the question looks right.

Do: report the failure as a finding about the skill, with the sentence that would fix it; never change the question only so it passes, and never lower the thresholds.

Even when: the user wants the run green; a question bent to pass protects nothing.

### rule: fix-when-asked

When: a question fails because the skill is unclear, and the user asked the agent to improve the skill.

Do: rewrite the unclear part of the skill, adding the idea the rule is missing rather than the question's wording, and ask the question again.

### rule: strengthen-borderline-questions

When: the report marks a verdict borderline.

Do: make the skill's text more direct on that point, or give the question more phrasings, since it passes when most of them pass and one phrasing cannot decide it; leave `thresholds.margin` as it is.
