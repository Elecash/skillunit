# SkillUnit — running the checks and reading a report

How to run the layers, read what they report, and act on a failure.

The default report is a table per layer, then the failures, the borderline verdicts and the warnings. Lint and proof findings read `file:line  unit-id  what is wrong`. A test failure shows the scenario, the expected answer, the answer the reader gave and the probability of each option. Exit codes: 0 when every check passed, 1 when one failed, 2 when the command itself was wrong (an unknown option, a missing file, no API key). `--reporter` also takes `json`, `junit` and `github` (annotations on the pull request).

| What the failure shows | What it means |
| --- | --- |
| `none` is high | the reader did not find the rule in the text |
| a wrong option is high | the text points to that answer |
| the expected answer, under the threshold | the text is ambiguous |

A verdict is borderline when the number that decided it is within `thresholds.margin` (0.13 by default) of its threshold. Answers move a little between runs, so a borderline test is the one most likely to change verdict next time. A borderline pass still passes.

## Rules

### rule: dry-run-first

When: the agent has written or changed specs.

Do: run `npx skillunit test --dry-run` and fix what it reports before the real run.

Right:

```sh
npx skillunit test --dry-run
```

### rule: prove-on-a-copy

When: the agent wants to show that a test depends on its rule.

Do: copy the skill folder, delete the rule's sentence in the copy, and run the spec against it with `--skill <copy>`; the test must fail.

Right:

```sh
cp -R skills/my-skill /tmp/my-skill-copy
npx skillunit test specs/retries.yaml --skill /tmp/my-skill-copy
```

### rule: still-green-without-the-rule

When: a test still passes on a copy with its rule deleted.

Do: look for the cause in this order: an option gives the answer away, the scenario contains the answer, the skill states the rule somewhere else, the reader knows the answer without the skill; fix the test in the first two cases, and tell the user in the last two.

### fact: no-mutations

When: the user asks for mutation testing of the specs.

Value: SkillUnit has no mutations; deleting a rule's sentence in a copy and running the spec against it (see `prove-on-a-copy`) does the same job.

Unknown: there is no mutation setting or tool; say so instead of adding one to the specs.

### rule: report-dont-bend

When: a test fails on the unmodified skill, and the test looks right.

Do: report the failure as a finding about the skill, with the sentence that would fix it; never change the test only so it passes, and never lower the thresholds.

Even when: the user wants the run green; a test bent to pass protects nothing.

### rule: fix-when-asked

When: a test fails because the skill is unclear, and the user asked the agent to improve the skill.

Do: rewrite the unclear part of the skill, adding the idea the rule is missing rather than the test's wording, and run the test again.

### rule: strengthen-borderline-tests

When: the report marks a verdict borderline.

Do: make the skill's text more direct on that point, or give the test more phrasings so the median decides; leave `thresholds.margin` as it is.
