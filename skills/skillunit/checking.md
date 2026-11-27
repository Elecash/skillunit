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

Value: a unit the skill folder has and no test declares is reported: its test was skipped or deleted, or did not run. `--write` takes it out of the skill after a run that passed.

### fact: failed-run

When: `proof.run` fails, and the run left no record of a unit, a file or a row of the index that the skill has.

Value: the finding on the run comes first, with the end of its output. A unit, a file or a row of the index that the skill has and that run left no record of is reported as such, and points at the run; `--write` takes none of them out until a run passes, and says which files it left as they are.

### fact: run-left-no-record

When: `proof.run` fails before any test writes a record, as when it type-checks the tests first and finds an error.

Value: the finding on the run is the only one. It shows the start of the run's output, up to 30 lines, where a type-check prints its errors; proof builds and compares nothing, and `--write` writes nothing.

### fact: unfinished-test

When: the test of a unit does not finish, because it times out or the run stops.

Value: each test writes a failed record when it starts and replaces it when it ends, so a test that does not finish leaves a record whose error is "the test did not finish, because it timed out or the run stopped before it ended". Its unit is reported as a failed test, at the line of the test, and `--write` leaves its file as it is.

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

Value: `skillunit` exits with 0 when every check passed, borderline verdicts included; with 1 when a check failed; and with 2 when the command itself was wrong: an option it does not take, a folder that is not there, no API key or settings that are not valid. Settings with no `proof` give 2 to `proof`, `test` and `check`: the skill and its questions both come from the records of `proof.run`.

### fact: reporters

When: a person, a script or CI reads what `skillunit` reports.

Value: `--reporter` takes `table`, `json`, `junit` and `github`; `table` is the default. `--json` is `--reporter json`: the whole report as JSON, with its `schema`, 7. `github` prints an annotation at the line of each finding, which GitHub Actions shows on the pull request.

### fact: origin

When: the proof reports a line of the skill.

Value: each finding about a line of the skill names the test that declares it: in `origin`, in the JSON report and after the finding in the table.

### rule: when-a-test-fails

When: the test of a unit fails after a change to the code.

Do: find out which moved. When the code changed on purpose, change the sentence and the body to say what the code does now, then `proof --write`; when it did not, fix the code. Never change the body only so that it passes.

Even when: the fix in the body is one line: a body that passes and a sentence that is false is the drift the skill is built to catch.
