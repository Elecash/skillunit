# SkillUnit — running the checks and reading a report

How to run the layers, read what a failed question shows, and act on it.

## Rules

### rule: dry-run-first

When: the agent has written or changed questions.

Do: run `npx skillunit test --dry-run` and fix what it reports before the real run.

### fact: pass-thresholds

When: the agent reads whether a question passed, or the user asks what it takes to pass.

Value: with the default `thresholds`, a question with options passes when the expected option alone is at the top, with a probability of at least 0.5; a yes/no question passes on a P(yes) of at least 0.7 when it expects `yes`, and of at most 0.3 when it expects `no`; a verdict closer than 0.13 to its threshold is borderline, and a borderline pass still passes.

### decision: read-a-failed-question

When: a question failed, and the agent reads what the reader answered.

Decide: what the failure says about the skill.

- **missing** — `none` is the answer at the top: the reader did not find the rule in the text.

- **elsewhere** — a wrong option is at the top: the text points to that answer.

- **ambiguous** — the expected answer is at the top, under the threshold: the text is ambiguous.

### rule: prove-on-a-copy

When: the agent wants to show that a question depends on its rule.

Do: copy the skill folder, delete the rule's sentence in the copy, and run `npx skillunit test --skill <copy>`; the question must fail.

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
