# Command line

```
skillunit check [options]           proof and test: what CI runs
skillunit proof [options]           run the tests that declare units, build the skill from `source`
                                    and those units, and compare it with the skill folder
skillunit test [options]            run the tests that declare units, and ask a decision model the
                                    questions they declare about the skill folder
skillunit init [skill]              create skillunit.yaml here, for that skill folder
```

`skillunit` with no command, or `--help`, prints the help.

Run `skillunit init skills/my-skill` from the project root. It writes `skillunit.yaml` there,
with `skill: ./skills/my-skill`, and `source` and `proof` commented out. Every other command
runs from that folder with no `--config`. When the folder has no `SKILL.md`, it gives the steps
that build one from the tests, `skillunit proof --write` last.

## Options

| Option | Commands | Meaning |
| --- | --- | --- |
| `--config <file>` | all | the settings file (default: `./skillunit.yaml`, if it exists) |
| `--skill <dir>` | all | the folder with `SKILL.md`, instead of the one in the settings |
| `--reporter <name>` | all | `table` (the default), `json`, `junit` or `github` |
| `--json` | all | the same as `--reporter json` |
| `--compact` | proof, test, check | with the `table` reporter, one row per unit; the other reporters ignore it |
| `--no-run` | proof, test, check | do not run `proof.run`; use the units and questions the tests already left |
| `--dry-run` | test, check | check that the questions can be asked, headings exist and requests fit; send nothing |
| `--changed` | test, check | ask only the questions about what changed in git since `--base` |
| `--base <ref>` | test, check | with `--changed`: the ref whose merge base with HEAD the working tree is compared with |
| `--provider <name>` | test, check | the decision model provider, `typesafe` or `openai`, instead of the one in the settings, with its default model unless `--model` is given too |
| `--model <name>` | test, check | the model of the provider in use (defaults: `jev-latest` for `typesafe`, `gpt-6-luna` for `openai`) |
| `--choice`, `--yes`, `--no`, `--margin <0-1>` | test, check | thresholds, as in the [configuration](configuration.md): `--yes` 0.5 or more and `--no` under 0.5, so a yes/no question passes only on the answer it expects |
| `--write` | proof | write the build to the skill folder instead of comparing |

A command rejects an option it does not take.

Only `--changed` reads git history.

`--changed` asks the questions about the files of the skill folder that changed in git since
`--base`: a question is asked when the file it is about, or a file in its `with`, changed.
Without `--base` it uses the pull request's target branch in
GitHub Actions, then the remote's default branch, then `origin/main`, `origin/master`, `main` or
`master`. It compares the working tree with the merge base of that ref and HEAD: a file counts
when it differs there, committed or not, and so does a new file git does not ignore. Commits
that landed on the main branch after the branch point do not count. In CI the tree is clean, so
that is what the branch's commits changed. When no question is about a changed file, the summary
says so and names the ref and the commit it compared with.

## Proof

`skillunit proof` empties `proof.units` of its records, runs `proof.run`, builds the skill from
`source` and the units the tests left, formats it with `proof.format`, and compares it with the
skill folder. It reports, for each unit, where it is declared: `proved by a test` or
`declared, no test`, with the file and line. It fails on a slot whose test failed or left no
unit, on a line of the skill folder that is not what the build gives, on a unit heading in the
source, and on the other cases
[Proof](proof.md#building-and-checking) lists. Each finding about a line of the skill says which
file that line comes from. Without `source` it exits 2, and `check` skips the layer and says so.

`--write` writes the build to the skill folder; commit it with the change. `--no-run` builds from
the units already in `proof.units`, for a pipeline that ran the tests in an earlier step.
`check` runs the proof before the model tests, `--dry-run` included, since it needs no key.

## Test

`skillunit test` runs `proof.run`, reads the questions from the records the tests left, and asks
them about the skill folder as it is. It does not build or compare the skill; that is `proof`.
`--no-run` uses the records already in `proof.units`. Without `source` it exits 2: the questions
are declared in the tests of a skill built from a source. `check` without `source` has no test
layer, and needs no key.

A question whose unit the skill folder does not have, or whose file is not there, cannot be
asked; it fails the run where it is declared. On its own, `test` also reports what `check` leaves
to its proof: a run of the tests that did not exit with 0, a record that is not valid, and a test
that failed, whose questions were not asked.

## Exit codes

- `0`: every check passed. Warnings and borderline verdicts do not fail a run.
- `1`: a check failed.
- `2`: the command itself was wrong: an unknown option, a missing file, bad settings, no API key
  for a run that needs one, or `proof` or `test` with no `source`.

Reports go to stdout, and errors about the command to stderr. With `--reporter json` or `--json`,
an exit 2 also prints `{ schema, command, ok: false, error: { exit: 2, message } }` on stdout, so
a script that parses stdout gets an object rather than nothing.

## Keys

`test` and `check` need the key of the provider they ask, except with `--dry-run`:
`TYPESAFE_API_KEY` for `typesafe` and `OPENAI_API_KEY` for `openai`. Each is read from the
environment, or from a `.env` file next to `skillunit.yaml` or in a folder above it, up to the git
root. A missing key is an exit 2 that names the variable. So
`skillunit check --provider openai` asks OpenAI the same questions without editing the settings, and
needs only `OPENAI_API_KEY`.

## Dry runs

`--dry-run` sends nothing to the decision model. It runs the tests that declare the questions,
checks that every question can be asked, every `section` heading exists, and every request fits
the model's limits, and prints the estimated size of each. It needs no key. `check --dry-run`
also runs the proof in full.

## Reporters

- `table`, for people, the default. See [Reading the table](#reading-the-table).
- `json`: the whole report as one object, `{ schema, command, ok, units, proof, test }`,
  with only the layers that ran. `units` lists every unit of the skill as `{ id, kind, file, line }`,
  so a tool can join the layers on the id: the `unit` of a proof finding or a verdict, and the
  `id` in `proof.units`; `proof` is `{ configured: false, ok: true }` when `check` ran
  with no `proof` key. `schema`, now 7, changes only when a field changes meaning or disappears.
  `test.provider` names the provider asked. `test.requests` has one entry per request: the
  `file`, `sections` and `with` files it read, and its `verdicts`, or its `error` and the
  `questions` it held. `test.problems` lists the questions that could not be asked, each with
  where it is declared. A verdict has `declared`, the test file and line of its question, and
  `unit` when it is about one; its `confidence` is the number that decided it: the probability of
  the option the reader picked, or P(yes). A verdict the model refused to answer has
  `refused: true`. A choice verdict whose top probability two options or more share has `tied`,
  those options; a tie never passes. A question with several phrasings has `variants`, the
  probability of the expected answer in each, and `variantsPass`, whether each passed. In
  `proof.units`, `from` is `test` for a unit a test proves and `declared` for one with no body.
  Each proof finding has `file`, `line`, `unit` when the line belongs to one, `severity`,
  `message`, and `origin`, where the line comes from. A proof finding about a line that is not what the
  build gives has `lines`, `{ build, skill }`, the two lines whole, `null` on the side that has
  no line there; its message shows each cut around the first difference. The JSON keeps every
  finding, whole.

  Every `file` in `units` and `proof`, the `origin` of a finding and the `source` and
  `test` of a unit included, starts from the skill folder, so the test of a unit is
  `../src/tinyfetch.test.ts`. The table prints the same paths from the folder it runs in.
  `proof.skill`, `proof.source` and the `declared` of a verdict or a test problem are absolute.
- `junit`: JUnit XML, one suite per layer and one per request, for CI systems that read it. The
  proof suite has one case per unit, with its state as a property; a question's case is named
  after its id, in the class of the file and line that declare it.
- `github`: GitHub Actions annotations, so each finding shows on its file and line in the pull
  request, a failed question on the line that declares it; then the status
  line.

## Reading the table

`check`, `proof` and `test` group the report by unit. An excerpt of `check` on tinyfetch:

```
  skill/features/retries.md
    what-is-retried  fact
      proof  ✓ proved by a test, src/tinyfetch.test.ts:208
      test   –
    retry-idempotent-only  rule
      proof  – declared, no test, src/tinyfetch.skill.test.ts:59
      test   ✗ src/tinyfetch.skill.test.ts:59  post-no-retry  no-retry 0.47
               scenario:  A payment is sent with `tf.post` to an API that sometimes answers 503.
               …
      test   ~ src/tinyfetch.skill.test.ts:59  patch-no-retry  no-retry 0.54
               probability 0.54, threshold 0.50 · borderline: the next run may fail it

Failed
  skill/features/retries.md › retry-idempotent-only › src/tinyfetch.skill.test.ts:59  post-no-retry
```

- Each file of the skill, then each unit in it, then one line for each thing that checks the
  unit: `proof` for where the unit is declared and what the build found,
  `test` for each of its questions, with the file and line that declare it.
- The mark says how it went:
  - `✓` passed
  - `✗` failed
  - `~` a warning, or a pass close to its threshold
  - `–` nothing in that layer checks this unit, or the unit is declared with no test
  - `·` a dry run: the test is ready and was not sent
- The details of a failure are right under it.
- `not covered` means no test proves the unit and no question asks about it. It does not fail
  the run.
- At the end, `Failed` lists every failure, then the status line says how each layer went.

`--compact` prints one row per unit instead, with its proof state and how many of its tests
passed. Colour is off with `NO_COLOR`, and the marks say the same thing without it. The JSON
report keeps everything.

## Borderline verdicts

Some decision models give the same questions on the same skill slightly different numbers from
one run to the next. Others give the same numbers for the same request, but a small change to the
wording or to the order of a question's options moves them. A verdict is borderline when the number that decided it is
within `thresholds.margin` (default 0.13) of its threshold: the probability of the option a choice
test picked, or P(yes) of a yes/no test. A wrong choice is borderline when the expected option is that close
behind the top one, and a tie for the top that includes the expected option is borderline too. A borderline pass still passes, and every reporter marks it, so the text can
be made more direct, or the question given more phrasings, before a run fails at random.
