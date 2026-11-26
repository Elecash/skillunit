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

{{unit:dry-run-first}}

{{unit:prove-on-a-copy}}

{{unit:still-green-without-the-rule}}

{{unit:no-mutations}}

{{unit:report-dont-bend}}

{{unit:fix-when-asked}}

{{unit:strengthen-borderline-questions}}
