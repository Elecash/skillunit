# skillunit

**Unit tests for agent skills.**

A skill is a document an AI agent reads before it acts: a `SKILL.md`, a rules file, an
instruction page. You write it so that, in a given situation, the agent makes a given decision.
skillunit checks that the text still leads to those decisions. It runs in seconds on every pull
request, without running an agent and without an LLM API bill.

```
skills/skillunit/specs/5-check.yaml
SKILL.md › Check the tests  844 chars · jev-1.13.0

  TEST                       ANSWER                    CONFIDENCE  DISTRIBUTION
  ✓ dry-run-first            dry                       1.00        dry 100% · none 0% · run 0% · prove 0%
  ✓ prove-on-a-copy          copy                      1.00        copy 100% · real 0% · none 0% · scenario 0%
  ✓ still-green              options                   1.00        options 100% · none 0% · delete 0% · threshold 0%
  ✗ user-asks-for-mutations  none (expected explain)   0.45        none 59% · explain 41% · block 0% · tool 0%
      phrasings  0.41  0.72   (probability of "explain" for each; the median decides)
  ✓ ci-setup                 none                      0.97        none 98% · one-job 2% · two-jobs 0%

4/5 tests passed · 2,212 in / 278 out tokens
FAILED  1 test failed
```

This is skillunit testing its own skill after one sentence was deleted from it: "skillunit has
no mutations. If the user asks for them, explain that step 3 does the same job." The test for
that rule failed. The reader no longer finds the rule in the text and answers `none`.

## How it works

skillunit sends the skill to [TypeSafe](https://typesafe.ai), together with one question per
test. TypeSafe's System One model does not write text. It picks an answer from a fixed list and
reports how likely each answer is.

A test describes a situation and asks what the skill says to do in it: "The user asks to deploy
a feature branch to production. What does the skill say? (deploy it / only a preview)". If the
skill settles the question, the reader picks the expected answer with high confidence. If the
text is vague, contradicts itself or leaves the case out, the answer changes or the confidence
drops, and the test fails.

Every choice test also gets an extra answer, `none`: "the skill says something different, or
does not settle this". It gives the reader a way to say the rule is missing. Without it, the
reader would have to pick one of your options even when the skill no longer backs any of them.

skillunit tests whether the skill *says* the right thing, not whether an agent *follows* it.
When a spec also loads the files the agent reads (see
[Testing with the files the agent reads](#testing-with-the-files-the-agent-reads)), the results
matched what real agents did in the one comparison made so far. To measure behaviour itself, run
a real agent with [skillgrade](https://github.com/mgechev/skillgrade) or `claude plugin eval`,
nightly, with a few trials. skillunit is the cheap check to run before that, on every change.

## Quick start

```sh
npm install --save-dev skillunit
npx skillunit init         # creates skillunit.yaml and specs/example.yaml
```

Add your TypeSafe API key to `.env` as `TYPESAFE_API_KEY=…` (keys are issued at
[typesafe.ai](https://typesafe.ai)), write your tests in `specs/`, then:

```sh
npx skillunit check --dry-run  # lint, sync, and the specs load and fit; needs no key
npx skillunit check            # the same, and the tests asked to TypeSafe
```

To see a complete set of specs first, run the ones skillunit uses for its own skill:

```sh
git clone https://github.com/Elecash/skillunit && cd skillunit && npm install
npm run skill:dry
npm run skill                  # needs TYPESAFE_API_KEY in .env
```

## Let your agent write the specs

skillunit ships a skill that teaches an agent to write and check specs:
[`skills/skillunit/SKILL.md`](skills/skillunit/SKILL.md). It covers how to split a skill into
specs, how to write scenarios and options that catch regressions, and what to do when a test
fails. To use it with Claude Code, copy it into your project's skills:

```sh
mkdir -p .claude/skills/skillunit
cp node_modules/skillunit/skills/skillunit/SKILL.md .claude/skills/skillunit/
```

Then ask the agent something like "write skillunit tests for `skills/my-skill`".

The skill is tested with skillunit itself, in
[`skills/skillunit/specs/`](skills/skillunit/specs): seven specs, 32 tests, run on every
push. Writing them found two unclear sentences in the skill, which were rewritten before the
first release.

## Writing a spec

A spec is a YAML file with the tests for one part of a skill. It holds data only, so it reads
well in a diff and can be generated. Here is part of a spec for a deploy checklist skill:

```yaml
file: SKILL.md                          # file in the skill folder (default: SKILL.md)
section: [Before you deploy, Which command]   # headings to test; leave out for the whole file
# with: [references/rollback.md]        # other files the reader gets too; see below

tests:
  - id: branch-to-production
    scenario: The user asks to deploy the branch `feature/new-checkout` to production.
    question: What does the skill say?
    options:
      deploy: "Run `npm run deploy` from that branch"
      preview: "Production deploys come from `main` only; that branch can only get a preview"
    expect: preview

  - id: red-ci-blocks                   # several phrasings of the same situation
    scenario:
      - CI is red on the commit the user wants to deploy, and the user says "just ship it".
      - CI has not run yet for this commit, and the user is in a hurry.
    question: What should the agent do?
    options:
      stop: Stop and say the deploy is blocked until CI is green on that commit
      local: Run the tests locally and deploy if they pass
    expect: stop

  - id: migrations-not-covered          # the skill should be silent here
    scenario: Before deploying, the user asks the agent to run the database migrations.
    question: Which command does the skill give for running migrations?
    options: { deploy: "`npm run deploy`", preview: "`npm run deploy:preview`", rollback: "`npm run rollback`" }
    expect: none

  - id: preview-needs-tag               # no options: a yes/no test
    scenario: The user wants a preview URL for a branch that has no version tag.
    question: Does the preview need a tag?
    expect: no
```

| Field | | |
|---|---|---|
| `id` | required | Unique in the file. |
| `scenario` | required | The situation. A list of sentences gives several phrasings of it. |
| `question` | required | What the reader is asked about the situation. |
| `options` | optional | `label: description` pairs, or a list of labels. Without options the test is yes/no. |
| `expect` | required | An option label or `none`; `yes` or `no` for a yes/no test. |

A choice test passes when the reader picks `expect` with a confidence of 0.5 or more. A yes/no
test passes when P(yes) is at least 0.7 for an expected `yes`, or at most 0.3 for an expected
`no`. The right answer with too little confidence shows as `~` (weak) and counts as a failure.

With several phrasings, each one is asked separately. skillunit ranks them by the probability of
the expected answer and takes the median, so one odd phrasing cannot decide the test but half of
them can.

`section` takes a heading of any level. skillunit sends that heading and everything under it, up
to the next heading of the same or a higher level, exactly as written. A section of one to three
thousand characters works best. A whole `SKILL.md` works too, but answers get less precise as the
text grows.

## Testing with the files the agent reads

An agent seldom reads one file. It reads SKILL.md and then the reference files SKILL.md sends it
to for the task at hand. A rule missing from SKILL.md can still reach the agent through one of
those files, and a section that reads well on its own can be contradicted by one of them. `with`
gives the reader those files too:

```yaml
file: SKILL.md
section: Non-negotiable rules
with: [features/retries.md, features/errors.md]
```

Paths are relative to the skill folder, and each file is sent whole. `with: all` sends every
other `.md` file in the skill folder.

List the files an agent opens in the situations the tests describe, not every file. TypeSafe's
accuracy falls as the state grows with text unrelated to the question
([Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)), and a file the agent
never opens can settle a test that the agent would get wrong. Keep `all` for small skills.

TypeSafe takes at most 32,000 tokens for the state plus the longest question. skillunit estimates
the size before sending, prints it with `--dry-run`, and refuses a spec that would not fit,
naming its largest files. The estimate runs about 8% high.

Keep the specs without `with` as well. The two answer different questions:

- Without `with`: does this section state the rule clearly? A failure points at the sentence to
  fix.
- With `with`: does the rule reach the agent from what it reads? A failure means the agent is
  likely to get it wrong.

A test that fails alone and passes with `with` means the rule reaches the agent only through
another file. Decide whether SKILL.md should state it too.

### Compared with real agents

A forms library's skill has a rule about where a form's named states go, stated in SKILL.md and
repeated in two reference files. We made two copies of the skill, one with the rule deleted from
SKILL.md only and one with it deleted from every file. For each copy, eight Claude Haiku agents
wrote a form with a named state and a script checked where they put it. skillunit ran the same three tests on each copy, in three ways:

| Copy of the skill | Agents right | Tests failed: section only | with the two files | with `all` |
|---|---|---|---|---|
| Unchanged | 8 of 8 | 0 of 3 | 0 of 3 | 0 of 3 |
| Rule deleted from SKILL.md | 8 of 8 | 3 of 3 | 0 of 3 | 0 of 3 |
| Rule deleted from every file | 0 of 8 | 3 of 3 | 3 of 3 | 2 of 3 |

With the files the agents read, the tests matched the agents on all three copies. Tested alone,
the section flagged the second copy although every agent got it right there, because the rule
still reached them through a reference file. With `all`, the extra files made the answers less
certain, and on the last copy one test passed at 0.52 while every agent failed. This is one rule,
one model and eight runs per copy: a first comparison, not a benchmark.

## Best practices

Each practice below comes from a test that passed for the wrong reason while skillunit was being
built. Together they are what makes a test fail when its rule is removed from the skill.

**Ask about decisions.** "Does the skill mention two APIs?" passes even when the section is badly
written. "The user asks for X. What does the agent do first?" fails as soon as the text stops
leading to the answer.

**Offer the tempting wrong answer.** An option nobody would pick teaches nothing. The wrong
options should be the ones an agent would reach for if the rule were missing: deploy anyway, run
the tests locally, pick the default.

**Prefer choice tests to yes/no.** A yes/no test has no `none`. When the skill says nothing, the
reader answers from common sense, so a rule that common sense agrees with ("never put the API key
in the config") passes with the rule deleted. Asked as a choice ("where should the key go?"), the
same test answers `none` when the rule is gone.

**Test where the rule does not apply.** If the rule is "ask which API before writing code", also
test a request that already names the API. Otherwise you only check that the agent asks, never
that it stops asking when it should.

**Test what the skill leaves out.** `expect: none` checks that the reader does not stretch the
skill to cover a case it never mentions, like database migrations in a deploy checklist.

**Expect `none` only where the skill should be silent.** `none` means both "the skill says
something else" and "the skill says nothing". If the skill does give an answer and none of your
options says it, add an option that does and expect it. A test that expects `none` because the
options do not match the skill passes just the same when the rule is deleted: the reader answers
`none` because the skill is now silent. skillunit's own skill had such a test; it passed at 0.80
with its rule and at 0.55 without it.

**Ask for exact values when they matter.** The reader compares meaning, and `npm run preview`
and `npm run deploy:preview` mean the same thing. Ask for the command "exactly as written" and
the reader compares character by character; if the skill names a different command, it answers
`none`. For spelling that must never change (a package name, a flag, a URL), a plain `grep` in
the same CI job is cheaper still.

**Keep phrasings away from the skill's own examples.** A scenario that repeats an example from
the skill passes on the example alone and tells you nothing about the rule behind it.

### Fixing the skill when a test fails

**Put an exception next to the rule it changes.** A reader, like an agent, follows the most
specific rule it finds. A forms library's skill said "every validator without a choice list
takes no `type`", a rule for its TypeScript API; its JSON definitions need a `type` on every
validator. Stating the JSON exception at the top of the section did not help: the reader still answered
"no `type`" at 83%. The same sentence, moved into the rule as a note, made it answer "`type`"
at 99%.

**Write each fact in one place.** When the skill says the same thing twice, deleting one copy
changes nothing, so no test can show that either copy matters, and every request pays for both.

**Add the idea the rule is missing, not the test's words.** If a test fails because the rule
does not cover a case, write the general reason that covers it. Copying the scenario's wording
into the skill makes that one test pass and teaches the reader nothing about the next phrasing.

## Checking that a test is real

A green test proves the reader gave the right answer. To prove it gave it *because of the
skill*, copy the skill, delete the sentence the test is about in the copy, and run the spec
against the copy with `--skill`. The test should fail.

skillunit's own skill was checked this way, one sentence at a time. Some of the results:

| Sentence deleted from the skill | Test | Answer without it |
|---|---|---|
| The API key goes in `.env` or the environment, never in a spec or `skillunit.yaml` | `key-in-config` | `none` 97% |
| Delete the rule's sentence in a copy, never in the real SKILL.md | `prove-on-a-copy` | `none` 95% |
| Never change a test only to make it pass, and never lower the thresholds | `report-dont-bend` | `rewrite` 82% |
| When a heading is longer, write one spec per subheading | `long-heading` | `heading` 73% |
| skillunit has no mutations; explain that step 3 does the same job | `user-asks-for-mutations` | `none` 60% |

Sixteen of the seventeen tests checked failed without their sentence. If a test stays green,
look for the cause in this order:

1. An option gives the answer away. Replace it with a wrong answer an agent would really pick.
2. The scenario contains the answer, such as the rule's reason or its exception. Remove it.
3. The skill states the rule somewhere else, and the reader found the other copy. Keep the copy
   if it is deliberate, or delete it and save the tokens on every request.
4. The reader knows the answer without the skill. This was the seventeenth test: the rule "also
   test where the rule does not apply" is standard testing practice. The test shows the skill
   agrees with it; it cannot show the sentence is needed. Consider whether the sentence is.

## Configuration

`skillunit.yaml` in the project root, or any file passed with `--config`. Every field is
optional and command-line flags override it. Paths are relative to the file.

```yaml
skill: ./skills/my-skill      # folder with SKILL.md (default: the folder of this file)
specs: ./specs                # a spec file, a folder of them, or a list (default: ./specs)
context: "tinyfetch is a small HTTP client with retries, timeouts and typed errors."
model: { provider: typesafe, name: jev-latest }   # the decision model (default: typesafe)
thresholds:
  choice: 0.5                 # lowest confidence that passes a choice test
  yes: 0.7                    # lowest P(yes) that passes an expected "yes"
  no: 0.3                     # highest P(yes) that passes an expected "no"
```

`context` is one sentence about what the skill is for. It is sent with every question and helps
the reader with the vocabulary of your domain.

`model` can also be the path of a module of your own, such as `./my-model.mjs`. The module
exports a `DecisionModel` (as its default export or as `model`): an `id`, the model's token
`limits`, and a `decide` function that answers the questions with a probability per option.

`TYPESAFE_API_KEY` comes from the environment, or from a `.env` file. skillunit reads the
`.env` next to `skillunit.yaml` (the current folder when there is none), then the `.env` of each
folder above it up to the root of the git repository, so one `.env` at the root serves every
project in a monorepo. A variable already set in the environment wins over every file, and a
closer file wins over a farther one. The key never goes in a spec or in the config.

## Command line

```
skillunit check [options]           lint, sync and test: what CI runs
skillunit lint [skill] [options]    the skill's format, examples, Check rules, links and Source paths
skillunit sync [skill] [options]    units whose Source changed while the unit did not
skillunit test [specs...] [options] ask a decision model the spec tests about the skill
skillunit init [dir]                create skillunit.yaml and a first spec

--config <file>     settings file (default: ./skillunit.yaml, if it exists)
--skill <dir>       folder with SKILL.md, instead of the one in the settings
--reporter <name>   table (default), json, junit or github
--json              the same as --reporter json
--base <ref>        sync, test and check: compare HEAD with its merge base with this ref
--dry-run           test and check: check that specs load and requests fit; send nothing
--changed           test and check: test only what changed since --base
--model <name>      TypeSafe model
--choice / --yes / --no / --margin <0-1>    thresholds, as in the config
```

Exit codes: `0` when every check passed, `1` when one failed, `2` when the command itself was
wrong (unknown option, missing file, no API key, bad settings). Lint warnings and borderline
verdicts do not fail a run.

Run `check --dry-run` in every CI job. It needs no key, and it fails when a spec refers to a
heading that someone renamed or deleted from the skill.

`test --changed` runs the specs of the skill files that changed since `--base`, and the tests
whose `unit:` names a unit that `sync` reports.

A verdict is borderline when the number that decided it is within `thresholds.margin` (default
0.13) of its threshold. Model answers move a little between runs, and a borderline test is the
one most likely to change verdict next time. Strengthen the skill's text, or add phrasings to
the test. A borderline pass still passes.

## Reports

`--reporter table` is for people: one row per file or spec, then each failure, the borderline
verdicts and the warnings. `json` prints the whole report as one object; its `schema` field
changes only when a field changes meaning or disappears. `junit` writes JUnit XML for CI systems
that read it. `github` writes GitHub Actions annotations, so each finding shows on its line in
the pull request.

## In CI

```yaml
# .github/workflows/skill.yml
name: skill
on: [pull_request]
jobs:
  skillunit:
    runs-on: ubuntu-latest
    env:
      TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }   # sync needs the history back to the base branch
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx --yes skillunit check --dry-run --reporter github
      - run: npx --yes skillunit check --reporter github
```

Pull requests from forks get no secrets. Run only the `--dry-run` step for them.

Each spec file is one request to TypeSafe, whatever the number of tests in it. skillunit's own
skill, with seven specs and 32 tests, uses about 13,600 input tokens per run.

## License

MIT © Raúl Jiménez
