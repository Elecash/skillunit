# Command line

```
skillunit check [options]           lint, sync and test: what CI runs
skillunit lint [skill] [options]    the skill's format, examples, Check rules, links and Source paths
skillunit sync [skill] [options]    units whose Source changed while the unit did not
skillunit test [specs...] [options] ask a decision model the spec tests about the skill
skillunit init [dir]                create skillunit.yaml and a first spec
```

`skillunit` with no command, or `--help`, prints the help.

## Options

| Option | Commands | Meaning |
| --- | --- | --- |
| `--config <file>` | all | the settings file (default: `./skillunit.yaml`, if it exists) |
| `--skill <dir>` | all | the folder with `SKILL.md`, instead of the one in the settings |
| `--reporter <name>` | all | `table` (the default), `json`, `junit` or `github` |
| `--json` | all | the same as `--reporter json` |
| `--base <ref>` | sync, test, check | compare HEAD with its merge base with this ref |
| `--dry-run` | test, check | check that specs load, headings exist and requests fit; send nothing |
| `--changed` | test, check | test only what changed since `--base` |
| `--model <name>` | test, check | the model name of the `typesafe` adapter |
| `--choice`, `--yes`, `--no`, `--margin <0-1>` | test, check | thresholds, as in the [configuration](configuration.md) |

A command rejects an option it does not take.

Without `--base`, sync uses the pull request's target branch in GitHub Actions, then the
remote's default branch, then `origin/main`, `origin/master`, `main` or `master`. It always
compares HEAD with the merge base of that ref and HEAD, so commits that landed on the main
branch after the branch point do not count.

`test --changed` runs the specs of the skill files that changed since `--base` (a spec runs when
its `file`, or a file in its `with`, changed), and the tests whose `unit` names a unit that sync
reports for review.

## Exit codes

- `0`: every check passed. Lint warnings and borderline verdicts do not fail a run.
- `1`: a check failed.
- `2`: the command itself was wrong: an unknown option, a missing file, bad settings, no API key
  for a run that needs one, or a `tsc` that rejects the tsconfig.

Reports go to stdout, and errors about the command to stderr.

## Dry runs

`--dry-run` sends nothing to the decision model. It checks that every spec loads, every
`section` heading exists, and every request fits the model's limits, and prints the estimated
size of each. It needs no key. `check --dry-run` also runs lint and sync in full.

## Reporters

- `table`, for people: one row per file or spec with counts, then each failure, the borderline
  verdicts and the warnings, and a status line. Lint and sync findings read
  `file:line  unit-id  what is wrong`, with `-` when the line belongs to no unit. A test failure
  shows the scenario, the question, the expected answer, the answer given and the probability of
  each option. Colour is on in a terminal, and off with `NO_COLOR`.
- `json`: the whole report as one object, `{ schema, command, ok, lint, sync, test }`, with only
  the layers that ran. `schema` changes only when a field changes meaning or disappears.
- `junit`: JUnit XML, one suite per layer and one per spec, for CI systems that read it.
- `github`: GitHub Actions annotations, so each finding shows on its file and line in the pull
  request, then the status line.

## Borderline verdicts

A decision model does not give the same number twice: the same tests on the same skill can move
a little from one run to the next. A verdict is borderline when the number that decided it is
within `thresholds.margin` (default 0.13) of its threshold: the confidence of a choice test, or
P(yes) of a yes/no test. A wrong choice is borderline when the expected option is that close
behind the top one. A borderline pass still passes, and every reporter marks it, so the text can
be made more direct, or the test given more phrasings, before a run fails at random.
