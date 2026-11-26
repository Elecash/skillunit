# SkillUnit — building and checking

What each command checks, the options it takes, and what it reports.

## Rules

### fact: options

When: an agent runs a command of `skillunit` with options.

Value: `proof` takes `--compact`, `--write` and `--no-run`. `test` and `check` take `--compact`, `--no-run`, `--base`, `--dry-run`, `--changed`, `--provider`, `--model`, `--choice`, `--yes`, `--no` and `--margin`. Each of them also takes `--config`, `--skill`, `--reporter` and `--json`. Any other option is refused, with exit code 2.

### fact: proof-compares

When: `proof` runs.

Value: without `--write`, `proof` compares the build with the skill folder, and reports each block of a file that differs and each file the folder lacks. With `--write`, it writes them to the folder instead.

### fact: stale-unit

When: a test that declares a unit is skipped or deleted.

Value: a unit the skill folder has and no test declares is reported: its test was skipped or deleted, or did not run. `--write` takes it out of the skill.

### fact: extra-file

When: the skill folder has a Markdown file of its own.

Value: a Markdown file in the skill folder that no `setup()` declares is reported, and `--write` leaves it there.

### fact: no-run

When: a command runs with `--no-run`.

Value: with `--no-run`, a command runs no `proof.run`, and builds from the records the last run left in `proof.units`.

### fact: dry-run

When: `test` or `check` runs with `--dry-run`.

Value: with `--dry-run`, nothing is sent to the decision model: the command checks that each question can be asked, that its headings are in its file, and that each request fits the model's limits, and the report gives an estimate of each request's tokens.

### fact: skill-copy

When: a command should read another folder than the skill of the settings, such as a copy.

Value: `--skill <dir>` makes a command read that folder instead of `skill` in the settings: `test --skill <copy>` asks the questions about the copy, and `proof --skill <copy>` compares the build with it.

### fact: changed

When: a run should ask only about what a branch changed, with `--changed`.

Value: `--changed` asks only the questions about the skill files, or their `with` files, that differ from the merge base of HEAD and `--base`, with uncommitted and untracked changes. Without `--base`, the base is the target branch of the pull request in GitHub Actions (`GITHUB_BASE_REF`), or else the default branch.

### fact: exit-codes

When: a script or CI reads what `skillunit` exited with.

Value: `skillunit` exits with 0 when every check passed, borderline verdicts included; with 1 when a check failed; and with 2 when the command itself was wrong: an option it does not take, a folder that is not there, no API key, or settings that are not valid.

### fact: reporters

When: a person, a script or CI reads what `skillunit` reports.

Value: `--reporter` takes `table`, `json`, `junit` and `github`; `table` is the default. `--json` is `--reporter json`: the whole report as JSON, with its `schema`, 7. `github` prints an annotation at the line of each finding, which GitHub Actions shows on the pull request.

### fact: origin

When: the proof reports a line of the skill.

Value: each finding about a line of the skill names the test that declares it: in `origin`, in the JSON report, and after the finding in the table.
