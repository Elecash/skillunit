# Command line

```
skillunit check [options]           lint, proof and test: what CI runs
skillunit lint [skill] [options]    the skill's format, examples, Check rules and links
skillunit proof [options]           run the project's tests, build the skill from `source` and the
                                    units the tests declare, and compare it with the skill folder
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
| `--compact` | proof, test, check | with the `table` reporter, one row per unit; the other reporters ignore it |
| `--no-run` | proof, check | do not run `proof.run`; build from the units the tests already left |
| `--dry-run` | test, check | check that specs load, headings exist and requests fit; send nothing |
| `--changed` | test, check | test only what changed in git since `--base` |
| `--base <ref>` | test, check | with `--changed`: compare HEAD with its merge base with this ref |
| `--provider <name>` | test, check | the decision model provider, `typesafe` or `openai`, instead of the one in the settings, with its default model unless `--model` is given too |
| `--model <name>` | test, check | the model of the provider in use (defaults: `jev-latest` for `typesafe`, `gpt-6-luna` for `openai`) |
| `--choice`, `--yes`, `--no`, `--margin <0-1>` | test, check | thresholds, as in the [configuration](configuration.md) |
| `--write` | proof | write the build to the skill folder instead of comparing |

A command rejects an option it does not take.

Only `--changed` reads git history.

`test --changed` runs the specs of the skill files that changed in git since `--base`: a spec
runs when its `file`, or a file in its `with`, changed. Without `--base` it uses the pull request's target branch in
GitHub Actions, then the remote's default branch, then `origin/main`, `origin/master`, `main` or
`master`, and compares HEAD with the merge base of that ref and HEAD, so commits that landed on
the main branch after the branch point do not count.

## Proof

`skillunit proof` empties `proof.units` of its records, runs `proof.run`, builds the skill from
`source` and the units the tests left, formats it with `proof.format`, and compares it with the
skill folder. It reports, for each unit, where it comes from: a test, with its file and line, or
the source, by hand. It fails on a slot whose test failed or left no unit, on a line of the skill
folder that is not what the build gives, and on the other cases
[Proof](proof.md#building-and-checking) lists. Each finding about a line of the skill says which
file that line comes from. Without `source` it exits 2, and `check` skips the layer and says so.

`--write` writes the build to the skill folder; commit it with the change. `--no-run` builds from
the units already in `proof.units`, for a pipeline that ran the tests in an earlier step.
`check` runs the proof before lint and the model tests, `--dry-run` included, since it needs no
key.

## Exit codes

- `0`: every check passed. Lint warnings and borderline verdicts do not fail a run.
- `1`: a check failed.
- `2`: the command itself was wrong: an unknown option, a missing file, bad settings, no API key
  for a run that needs one, a `tsc` that rejects the tsconfig, or `proof` with no `source`.

Reports go to stdout, and errors about the command to stderr. With `--reporter json` or `--json`,
an exit 2 also prints `{ schema, command, ok: false, error: { exit: 2, message } }` on stdout, so
a script that parses stdout gets an object rather than nothing.

## Keys

`test` and `check` need the key of the provider they ask, except with `--dry-run`:
`TYPESAFE_API_KEY` for `typesafe` and `OPENAI_API_KEY` for `openai`. Each is read from the
environment, or from a `.env` file next to `skillunit.yaml` or in a folder above it, up to the git
root. A missing key is an exit 2 that names the variable. So
`skillunit check --provider openai` asks OpenAI the same specs without editing the settings, and
needs only `OPENAI_API_KEY`.

## Dry runs

`--dry-run` sends nothing to the decision model. It checks that every spec loads, every
`section` heading exists, and every request fits the model's limits, and prints the estimated
size of each. It needs no key. `check --dry-run` also runs lint and proof in full.

## Reporters

- `table`, for people, the default. See [Reading the table](#reading-the-table).
- `json`: the whole report as one object, `{ schema, command, ok, units, lint, proof, test }`,
  with only the layers that ran. `units` lists every unit of the skill as `{ id, kind, file, line }`,
  so a tool can join the layers on the id: the `unit` of a lint problem or a verdict, and the `id`
  in `proof.units`; `proof` is `{ configured: false, ok: true }` when `check` ran
  with no `proof` key. `schema` changes only when a field changes meaning or disappears.
  `test.provider` names the provider asked. A verdict's `confidence` is the number that decided
  it: the probability of the option the reader picked, or P(yes). A verdict the model refused to
  answer has `refused: true`.
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

## Reading the table

`check`, `proof` and `test` group the report by unit. An excerpt of `check` on tinyfetch:

```
  skill/features/retries.md
    what-is-retried  fact
      proof  ✓ src/tinyfetch.test.ts › tinyfetch > retries network errors and 5xx, not 4xx or a timeout
      test   –
    retry-idempotent-only  rule
      proof  –
      test   ✗ specs/retries.yaml:4  post-no-retry  no-retry 0.47
               scenario:  A payment is sent with `tf.post` to an API that sometimes answers 503.
               …
      test   ~ specs/retries.yaml:15  patch-no-retry  no-retry 0.54
               probability 0.54, threshold 0.50 · borderline: the next run may fail it

Failed
  skill/features/retries.md › retry-idempotent-only › specs/retries.yaml:4  post-no-retry
```

- Each file of the skill, then each unit in it, then one line for each thing that checks the
  unit: `lint` for a finding, `proof` for a test tagged for it, `test` for a spec test that
  names it.
- The mark says how it went:
  - `✓` passed
  - `✗` failed
  - `~` a warning, or a pass close to its threshold
  - `–` nothing in that layer checks this unit
  - `·` a dry run: the test is ready and was not sent
- The details of a failure are right under it.
- `not covered` means no test of either kind checks the unit. It does not fail the run.
- At the end, `Failed` lists every failure, then the status line says how each layer went.

`--compact` prints one row per unit instead, with its proof state and how many of its tests
passed. `lint` alone lists its findings by file. Colour is off with `NO_COLOR`, and the marks
say the same thing without it. Long lint output is trimmed to three findings per example; the
JSON report keeps everything.

## Borderline verdicts

Some decision models give the same tests on the same skill slightly different numbers from one
run to the next. Others give the same numbers for the same request, but a small change to the
wording or to the order of a test's options moves them. A verdict is borderline when the number that decided it is
within `thresholds.margin` (default 0.13) of its threshold: the probability of the option a choice
test picked, or P(yes) of a yes/no test. A wrong choice is borderline when the expected option is that close
behind the top one. A borderline pass still passes, and every reporter marks it, so the text can
be made more direct, or the test given more phrasings, before a run fails at random.
