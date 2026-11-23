# Command line

```
skillunit check [options]           lint, proof and test: what CI runs
skillunit lint [skill] [options]    the skill's format, examples, Check rules and links
skillunit proof [skill] [options]   units the project's tests prove, from their JUnit report, and
                                    whether each block flagged proof=<id> holds what its test produced
skillunit test [specs...] [options] ask a decision model the spec tests about the skill
skillunit init [skill]              create skillunit.yaml and a first spec here, for that skill folder
```

`skillunit` with no command, or `--help`, prints the help.

Run `skillunit init skills/my-skill` from the project root. It writes `skillunit.yaml`, with `skill: ./skills/my-skill`, and `specs/example.yaml` in that root, and turns on the type-check of TypeScript examples when a `tsconfig.json` is there. Every other command runs from that folder with no `--config`.

## Options

| Option | Commands | Meaning |
| --- | --- | --- |
| `--config <file>` | all | the settings file (default: `./skillunit.yaml`, if it exists) |
| `--skill <dir>` | all | the folder with `SKILL.md`, instead of the one in the settings |
| `--reporter <name>` | all | `table` (the default), `json`, `junit` or `github` |
| `--json` | all | the same as `--reporter json` |
| `--dry-run` | test, check | check that specs load, headings exist and requests fit; send nothing |
| `--changed` | test, check | test only what changed in git since `--base` |
| `--base <ref>` | test, check | with `--changed`: compare HEAD with its merge base with this ref |
| `--model <name>` | test, check | the model name of the `typesafe` adapter |
| `--choice`, `--yes`, `--no`, `--margin <0-1>` | test, check | thresholds, as in the [configuration](configuration.md) |
| `--write` | proof | copy each example a test produced into its block, add the units the tests prove to `skillunit.lock`, then check |
| `--forget <ids>` | proof | take these units off `skillunit.lock`, then check; ids separated by commas, or the option more than once |

A command rejects an option it does not take.

Only `--changed` reads git history.

`test --changed` runs the specs of the skill files that changed in git since `--base`: a spec
runs when its `file`, or a file in its `with`, changed. Without `--base` it uses the pull request's target branch in
GitHub Actions, then the remote's default branch, then `origin/main`, `origin/master`, `main` or
`master`, and compares HEAD with the merge base of that ref and HEAD, so commits that landed on
the main branch after the branch point do not count.

## Proof

`skillunit proof` reads the JUnit XML report of a test run, the examples the tests wrote and the
regions of the test files, as `proof` in `skillunit.yaml` says, and compares them with
`skillunit.lock`. It reports the units proved, failed and unproved. It fails on a tagged test
that failed, on a unit the lock lists and no test proves, on a proved unit the lock does not
list, on a block flagged `proof=<id>` that differs from what its test produced, and on the other
cases [Proof](proof.md#what-it-reports) lists. It never runs the tests: run them before it.
Without a `proof` key it exits 2, and `check` skips the layer and says so.

`--write` copies every example into its block and adds the units the tests prove to the lock.
`--forget a,b` takes units off the lock, all of them or none, for units no longer meant to be
proved. Both then run the check. Commit the lock with the change.

## Exit codes

- `0`: every check passed. Lint warnings and borderline verdicts do not fail a run.
- `1`: a check failed.
- `2`: the command itself was wrong: an unknown option, a missing file, bad settings, no API key
  for a run that needs one, a `tsc` that rejects the tsconfig, `proof` with no `proof` key, or
  `--forget` with `--write`.

Reports go to stdout, and errors about the command to stderr. With `--reporter json` or `--json`,
an exit 2 also prints `{ schema, command, ok: false, error: { exit: 2, message } }` on stdout, so
a script that parses stdout gets an object rather than nothing.

## Dry runs

`--dry-run` sends nothing to the decision model. It checks that every spec loads, every
`section` heading exists, and every request fits the model's limits, and prints the estimated
size of each. It needs no key. `check --dry-run` also runs lint and proof in full.

## Reporters

- `table`, for people: one row per file or spec with counts, then each failure, the borderline
  verdicts and the warnings, and a status line. Lint and proof findings read
  `file:line  unit-id  what is wrong`, with `-` when the line belongs to no unit. A test failure
  shows the scenario, the question, the expected answer, the answer given and the probability of
  each option. Colour is on in a terminal, and off with `NO_COLOR`.

  To keep a skill of fragments readable, lint findings come in one block per file, at most three
  per example with the rest counted ("+2 more in this example"), each line and message once, and
  the type problems are counted by code at the end. When some names are never declared ("Cannot
  find name", `TS2304` and `TS2552`), the five most frequent follow, with their counts, and a
  line on the `Setup` block that declares them. Clean files get no row, only their number. A
  message is cut after 400 characters. Paths start from the current folder, or from the skill
  folder, which the header names, when the skill is outside it.
- `json`: the whole report as one object, `{ schema, command, ok, lint, proof, test }`,
  with only the layers that ran; `proof` is `{ configured: false, ok: true }` when `check` ran
  with no `proof` key. `schema` changes only when a field changes meaning or disappears.
  Each lint problem has `file`, `line`, `unit` when the line belongs to one, `severity`, `rule`
  and `message`, plus `code`, such as `TS2322`, and `example`, the line where the example
  starts, when the type-check found it. `lint.summary`
  counts the examples that went through the type-check (`typeChecked`) apart from those that did
  not parse (`notParsed`), and lists in `undeclared` every name that nothing declares, as
  `{ name, count }`, the most frequent first. The JSON keeps every finding, whole.
- `junit`: JUnit XML, one suite per layer and one per spec, for CI systems that read it. The
  proof suite has one case per unit, with its state as a property.
- `github`: GitHub Actions annotations, so each finding shows on its file and line in the pull
  request; a notice with the names that nothing declares, when there are some; then the status
  line.

## Borderline verdicts

A decision model does not give the same number twice: the same tests on the same skill can move
a little from one run to the next. A verdict is borderline when the number that decided it is
within `thresholds.margin` (default 0.13) of its threshold: the confidence of a choice test, or
P(yes) of a yes/no test. A wrong choice is borderline when the expected option is that close
behind the top one. A borderline pass still passes, and every reporter marks it, so the text can
be made more direct, or the test given more phrasings, before a run fails at random.
