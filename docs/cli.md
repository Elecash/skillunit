# Command line

```
skillunit check [options]           lint, sync and test: what CI runs
skillunit lint [skill] [options]    the skill's format, examples, Check rules, links and Source paths
skillunit sync [skill] [options]    units whose code changed since skillunit.lock recorded their review
skillunit review [options]          show what changed for each unit sync reports, and accept it
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
| `--dry-run` | test, check | check that specs load, headings exist and requests fit; send nothing |
| `--changed` | test, check | test only what changed in git since `--base` |
| `--base <ref>` | test, check | with `--changed`: compare HEAD with its merge base with this ref |
| `--model <name>` | test, check | the model name of the `typesafe` adapter |
| `--choice`, `--yes`, `--no`, `--margin <0-1>` | test, check | thresholds, as in the [configuration](configuration.md) |

A command rejects an option it does not take.

Sync compares `skillunit.lock` with the code and needs no git (see
[the lock](configuration.md#skillunitlock)), so it takes no `--base`. Only `--changed` reads git
history.

`test --changed` runs the specs of the skill files that changed in git since `--base` (a spec
runs when its `file`, or a file in its `with`, changed), and the tests whose `unit` names a unit
that sync reports as stale or new. Without `--base` it uses the pull request's target branch in
GitHub Actions, then the remote's default branch, then `origin/main`, `origin/master`, `main` or
`master`, and compares HEAD with the merge base of that ref and HEAD, so commits that landed on
the main branch after the branch point do not count.

## Review

`skillunit review` clears the units sync reports. It groups the units by source file,
and for each file shows what changed, then each unit with its `file:line` and its text. Inside a
git repository, what changed is the diff from the merge base with the default branch to the
working tree, cut down to the declaration when the `Source` names a `#symbol`; outside git it is
only the path. A new unit has no diff: review prints where its code is, `path:line`, to open in
an editor. Every path is printed from the folder the command runs in, so an editor's terminal
can open it. A unit whose text differs from the merge base is marked "edited in this change",
as a hint; it still has to be accepted.

At a terminal, review asks about each unit: `a` accept, `e` open the unit in `$VISUAL` or
`$EDITOR` at its line and ask again, `s` skip, `A` accept the rest of this file, `q` quit and
keep what was accepted. Without a terminal, or for an agent:

| Option | Meaning |
| --- | --- |
| `--list` | print the units to review and what changed; change nothing. The default without a terminal |
| `--json` | the same as `--list`, as JSON, with `path`, `line` and the line range of each `Source` |
| `--accept <id>...` | accept these units: write the fingerprints of their code as it is now |
| `--accept-all` | accept every unit to review |
| `--prune` | drop lock entries for units, or `Source` values, that no longer exist |

Review writes `skillunit.lock`, says what it changed, and never commits. On the first run there
is no lock and every unit is new; `review --accept-all` writes it, which records every unit as
reviewed, so read the units once before running it.

For `e`, VS Code and its forks get `--goto file:line`, Sublime Text and Zed `file:line`,
JetBrains IDEs `--line <n> file`, and other editors `+<n> file`. The editor command must wait
until the file is closed, such as `code --wait`.

## Exit codes

- `0`: every check passed. Lint warnings and borderline verdicts do not fail a run.
- `1`: a check failed. For `review --list`, and `review` without a terminal: some unit needs
  review.
- `2`: the command itself was wrong: an unknown option, a missing file, bad settings, no API key
  for a run that needs one, a `tsc` that rejects the tsconfig, a lock this version cannot read,
  or `review --accept` with an id that is not a unit.

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
