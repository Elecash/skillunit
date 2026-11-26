# SkillUnit

[![CI](https://github.com/Elecash/skillunit/actions/workflows/ci.yml/badge.svg)](https://github.com/Elecash/skillunit/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/skillunit)](https://www.npmjs.com/package/skillunit)

The API changes, the skill does not, and agents keep writing code for the version the skill describes. Nothing fails, so nobody notices.

SkillUnit ties the instructions of an agent skill to the tests of the code they describe, and fails CI when a test and the skill disagree. It is for skills that describe code, such as a library, an API, a CLI or an SDK.

It checks a skill in three layers:

- **Lint** type-checks the examples of the skill against the API, with the project's own TypeScript compiler, and checks them against the skill's own rules. It reports an example that no longer compiles, an example that breaks a rule and a broken link.
- **Proof** builds the instructions that a test can check from the test itself. The test declares the instruction with `unit()`, every value it states has a name in the code and its sentence is built from that name, and the skill is built from a source folder and those tests. When the code changes, the built skill changes, and `check` fails until the skill in the repository says the same.
- **Test** asks a decision model closed questions about the skill. A test fails when the text does not settle the answer, such as a rule too vague to follow. In our runs on tinyfetch, a sentence of the prose that contradicts a rule pulled the answers to the threshold, and the rule still won.

`skillunit check` runs the three and prints each unit of the skill with what each layer found about it. On [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch), with `--dry-run`, which sends the tests nowhere and needs no key, cut to two of its six files:

```
Lint  skill
  ✓ 6 files, all clean
  16 units · 19 examples type-checked with TypeScript 5.6.3

Units  proof ran `npx vitest run` in 0.5 s, exit 0 · test dry run: nothing sent
  …
  skill/SKILL.md
    test   · src/tinyfetch.skill.test.ts:137  which-file-for-retries  ready
    await-every-request  rule
      proof  ✓ proved by a test, src/tinyfetch.test.ts:83
      test   · src/tinyfetch.test.ts:83  await-the-call  ready

  skill/features/retries.md
    retry-defaults  fact
      proof  ✓ proved by a test, src/tinyfetch.test.ts:286
      test   · src/tinyfetch.test.ts:286  retry-delay-default  ready
    what-is-retried  fact
      proof  ✓ proved by a test, src/tinyfetch.test.ts:259
      test   –
    retry-idempotent-only  rule
      proof  – declared, no test, src/tinyfetch.skill.test.ts:59
      test   · src/tinyfetch.skill.test.ts:60  post-no-retry  ready
      test   · src/tinyfetch.skill.test.ts:60  patch-no-retry  ready
      test   · src/tinyfetch.skill.test.ts:60  retry-methods  ready
      test   · src/tinyfetch.skill.test.ts:60  put-may-retry  ready
      test   · src/tinyfetch.skill.test.ts:60  get-may-retry  ready
  …

  16 units · 6 proof and test · 7 proof only · 3 test only · 0 not covered
  16 units · 13 proved by a test · 3 declared without one · 5 values in prose
  16 tests

OK  lint ok · proof ok · test dry run ok, 16 tests ready
```

Each `test` line is a question for the decision model, at the line of the test file that declares it. A `–` is a layer with nothing on that unit, and `declared, no test` a unit declared with no body, such as advice, which no test proves. A unit with neither proof nor a question reads `not covered`.

What it costs to run:

- **A check takes seconds.** Lint and proof take under half a second each on the two skills of this repository (0.35 to 0.47 s on a 14-core laptop), plus the time of the tests that declare units, which proof runs. The decision model answers the questions about one file in under a second, however many there are: 58 questions about 8 files take about 1.5 seconds on TypeSafe and 3 on OpenAI.
- **Lint and proof need no model and no key.** They run on pull requests from forks, which get no secrets.
- **The test layer costs a fraction of a cent per run.** See [what a run costs](https://github.com/Elecash/skillunit/blob/main/docs/ci.md#what-a-run-costs).

## Quick start

```sh
npm install --save-dev skillunit
npx skillunit init skills/my-skill
```

`init` writes `skillunit.yaml`, and lint works at once:

```sh
npx skillunit lint
```

Proof builds the skill from a source folder and the units your tests declare. Move the skill to a source folder and set `source` and `proof.run` in `skillunit.yaml`. Then declare each unit in code with `unit()` from `skillunit/vitest`: around the test that checks what it says, or with no body for advice no test can check. Put `{{unit:<id>}}` in the source where each one goes, build the skill, and commit both folders:

```yaml
skill: ./skills/my-skill
source: ./skills-src/my-skill
proof:
  run: "npx vitest run skill.test"   # the test files that declare units: *.skill.test.ts
```

```sh
npx skillunit proof --write
```

The questions for the decision model go with their unit, in its `ask`, and a question about the prose of a file goes in `ask()`. [Proof](https://github.com/Elecash/skillunit/blob/main/docs/proof.md) has the `unit()` API, the slots, and the JSON a test in another language writes; [Questions](https://github.com/Elecash/skillunit/blob/main/docs/questions.md) has the fields of a question.

SkillUnit ships a skill that teaches an agent to write a skill in units, to declare its units and questions in tests, to write its examples, and to act on a report. Install it with [skills.sh](https://skills.sh):

```sh
npx skills add https://github.com/Elecash/skillunit --skill skillunit
```

Then ask the agent, for example: "Rewrite `skills/my-skill` in units, declared in our tests with SkillUnit, with questions for each."

The test layer needs a decision model:

| Decision model | Adapter | Models | Key |
| --- | --- | --- | --- |
| [TypeSafe](https://typesafe.ai) | `typesafe`, the default | `jev-latest`, or any model TypeSafe lists | `TYPESAFE_API_KEY` |
| [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions) | `openai` | `gpt-6-luna` | `OPENAI_API_KEY` |
| Your own | a module that exports a `DecisionModel` | any | [see the configuration](https://github.com/Elecash/skillunit/blob/main/docs/configuration.md#a-decision-model-of-your-own) |

Pick one with `model: { provider: openai }` in `skillunit.yaml`, or `--provider openai` for a single run. Models can answer the same question differently (OpenAI's is more decisive than Jev), so pick one and write your questions for it. Put that provider's key in the environment, or in a `.env` file next to `skillunit.yaml` or at the root of the repository. Then run every layer:

```sh
npx skillunit check
```

## How it works

### Units

Each instruction of a skill is a unit: a heading with its kind and its id, labelled paragraphs that the agent reads, and an optional `Check` that lint reads. There are three kinds. The examples are from the built skill of [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch/skill), the decision without its optional labels, and the [style guide](https://github.com/Elecash/skillunit/blob/main/docs/style-guide.md) describes the format. In a skill built with proof, every unit is declared in code and the build writes it in this format.

**A rule** is a constraint on what the agent writes.

````md
### rule: retry-idempotent-only

When: a request may be retried.

Do: enable `retry` only for GET, HEAD, PUT and DELETE.

Right:

```ts
await tf.get("https://api.example.com/users", { retry: 3 });
```

Check: forbid `/\.(post|patch)\([^)]*retry/` in ts
````

**A decision** is a choice between paths, each with the condition that selects it.

```md
### decision: one-client-per-api

When: the code makes several requests to the same API.

Decide: whether to create a client.

- **shared** — the requests share a base URL or headers: create one client with `create` and reuse it.

- **direct** — one request, or requests to unrelated hosts: call `tf` with full URLs.
```

**A fact** is a value the agent must state exactly.

```md
### fact: default-timeout

When: the user asks how long a request waits by default.

Value: 10 seconds (`timeout: 10_000`), for every method.

Unknown: tinyfetch has no separate connect timeout; say so instead of inventing one.
```

Each layer below is shown with a change to tinyfetch and the line SkillUnit prints for it.

### Lint

Lint type-checks every TypeScript and JavaScript example with the project's own `tsc`. It runs every `Check`, a regex that no example may match, over every example of the skill. It also reports a malformed unit and a broken link.

**The code changes, and an example no longer compiles.** In `src/types.ts`:

```diff
-  retryDelay?: number;
+  backoff?: number;
```

An example of the skill still passes `retryDelay`:

```
1) skill/features/retries.md:19  -  does not type-check: TS2353 Object literal may only specify known properties, and 'retryDelay' does not exist in type 'RequestOptions'.
```

**An example breaks a rule.** The `Right` example of the rule above is a region of `src/tinyfetch.skill.test.ts`, where the rule is declared. Change it and build the skill:

```diff
-await tf.get('https://api.example.com/users', { retry: 3 });
+await tf.post('https://api.example.com/orders', { item: 42 }, { retry: 3 });
```

```
1) skill/features/retries.md:45  retry-idempotent-only  breaks `retry-idempotent-only`: `.post("https://api.example.com/orders", { item: 42 }, { ret…` matches its `Check` (features/retries.md:48)
```

### Proof

A unit that a test can check is declared in that test, and the skill is built from a source folder and the tests. A unit no test can check, such as the rule above, which is about what a server does with a repeated request, is declared with `unit()` and no body, and the report calls it declared, never proved. `skillunit proof` runs the tests through `proof.run`, builds the skill, and compares it with the skill folder. [Proof](https://github.com/Elecash/skillunit/blob/main/docs/proof.md) describes `unit()`, the slots and the settings.

**The code changes, and a fact would be false.** tinyfetch's test builds the `Value` of `default-timeout` from the constant:

```ts
unit(
  'default-timeout',
  {
    when: 'the user asks how long a request waits by default.',
    value: `${DEFAULT_TIMEOUT / 1000} seconds (\`timeout: ${underscored(DEFAULT_TIMEOUT)}\`), for every method.`,
    values: { seconds: DEFAULT_TIMEOUT / 1000, ms: underscored(DEFAULT_TIMEOUT) },
  },
  async () => {
    // every method times out after DEFAULT_TIMEOUT
  },
);
```

In `src/timeout.ts`:

```diff
-export const DEFAULT_TIMEOUT = 10_000;
+export const DEFAULT_TIMEOUT = 5_000;
```

The tests pass, since they assert what the constant says. The built skill now says 5 seconds, the skill in the repository says 10, and proof names the line, the unit and the test it comes from:

```
  skill/features/timeouts.md
    default-timeout  fact
      proof  ✓ proved by a test, src/tinyfetch.test.ts:327
      proof  ✗ skill/features/timeouts.md:42  this line is not what the build gives: the build has `Value: 5 seconds ('timeout: 5_000'), for every method.`, the skill has `Value: 10 seconds ('timeout: 10_000'), for every method.`. Run `skillunit proof --write` to update the skill. To change this text, change where it comes from: the skill folder is built.
               from the test of `default-timeout`, src/tinyfetch.test.ts:327
```

The options table, which shows the default through `{{value:default-timeout.ms}}`, fails too. `skillunit proof --write` rewrites both, and the change to the skill goes in the same pull request as the change to the code. The question about the default needs no edit either: its options are built from the same constant, so after the build it offers 5 seconds as the right answer.

**No value typed twice.** That works only when the value has a name. Every value that defines behaviour has a name in the code, the code and the test's assertion use it, and the sentence is built from it, with no number or word such as "doubled" typed in. tinyfetch's skill once said the wait between retries is "doubled", with `2 ** n` in the code and `2 *` in the test: the code went to `3 ** n`, the assertion was edited, and the skill kept "doubled". With `RETRY_TIMES` in all three, changing the constant fails the proof on both lines until `--write` makes them "3x". `unit()` fails a unit with a body whose text has a number none of its `values` is. The [style guide](https://github.com/Elecash/skillunit/blob/main/docs/style-guide.md#units-declared-in-code) has the rule.

### Test

The questions for the decision model are declared in code with their unit, in its `ask`, so an option can use what the code has:

```ts
ask: {
  scenario: 'The user asks how long a tinyfetch request waits before it gives up, when the code sets nothing.',
  question: 'What should the agent answer?',
  options: {
    right: `${DEFAULT_TIMEOUT / 1000} seconds`,
    longer: `${(3 * DEFAULT_TIMEOUT) / 1000} seconds`,
    forever: 'It waits until the server answers',
  },
  expect: 'right',
},
```

The test runner only records them. SkillUnit asks them about the skill folder: a decision model reads the file that holds the unit and gives each answer a probability, and a question passes when the expected answer wins with a high enough probability. [Questions](https://github.com/Elecash/skillunit/blob/main/docs/questions.md) describes the fields.

**A rule too vague to follow.** `retry-idempotent-only` is declared with no body in `src/tinyfetch.skill.test.ts`, since no test of the library can check what a server does with a repeated request. Weaken its `Do`, then build with `npx skillunit proof --write`:

```diff
-  do: 'enable `retry` only for GET, HEAD, PUT and DELETE.',
+  do: 'think about whether `retry` suits the method before you enable it.',
```

The rule no longer names a method. Asked which methods may get `retry`, the model answers `none`; asked about a PUT, it leaves `retry` off. Both questions fail with a wrong answer, on each of four runs on 2026-11-26, at 0.63 to 0.75 for the wrong option. The questions about a POST and a PATCH still pass, since leaving `retry` off is the safe reading of a vague rule:

```
  skill/features/retries.md
    retry-idempotent-only  rule
      test   ✓ src/tinyfetch.skill.test.ts:60  post-no-retry  no-retry 0.84
      test   ✓ src/tinyfetch.skill.test.ts:60  patch-no-retry  no-retry 0.91
      test   ✗ src/tinyfetch.skill.test.ts:60  retry-methods  none 0.75
               scenario:  The agent adds `retry` to the calls of a client that uses every method tinyfetch has.
               question:  Which methods may get `retry`?
               expected:  idempotent
               got:       none · probability 0.75, threshold 0.50 · wrong answer
                          none 75% · reads 13% · idempotent 12% · all 0%
      test   ✗ src/tinyfetch.skill.test.ts:60  put-may-retry  no-retry 0.66
               scenario:  A settings document is replaced with `tf.put`, and the API sometimes answers 503.
               question:  Should the agent pass `retry` to that call?
               expected:  retry
               got:       no-retry · probability 0.66, threshold 0.50 · wrong answer
                          no-retry 66% · none 32% · retry 2%
      test   ✓ src/tinyfetch.skill.test.ts:60  get-may-retry  yes P(yes) 0.96
```

A sentence of the prose that contradicts the same rule moves the model less. With "retrying is safe for every method, and `retry` belongs on POST and PATCH calls as much as on GET" in the prose of `retries.md`, the questions about a POST and a PATCH ended at 0.50 to 0.58 over five runs: borderline, and passing.

SkillUnit checks what a skill says. It does not check whether an agent follows it.

## Try it

Clone the repository, build SkillUnit and check tinyfetch:

```sh
git clone https://github.com/Elecash/skillunit
cd skillunit
npm ci
npx nx build skillunit
cd apps/tinyfetch
npx skillunit check --dry-run
```

The check runs the tests itself, through `proof.run`, and ends with:

```
OK  lint ok · proof ok · test dry run ok, 16 tests ready
```

Then break one thing at a time. Each experiment starts from a clean tree, and `git checkout .` undoes it. The first three need no key. The skill people write is in `skill-src`, `skill` is built from it, and the units are declared in `src/tinyfetch.test.ts` and, for those no test proves, `src/tinyfetch.skill.test.ts`.

### An option renamed in the code

In `src/types.ts`, rename the option `retryDelay` to `backoff`, then run `npx skillunit lint`. The skill still shows `retryDelay`:

```
1) skill/features/retries.md:19  -  does not type-check: TS2353 Object literal may only specify known properties, and 'retryDelay' does not exist in type 'RequestOptions'.
```

### An example that breaks its own rule

In `src/tinyfetch.skill.test.ts`, change the region `skill:retry-idempotent-only`, the `Right` example of the rule, to `await tf.post('https://api.example.com/orders', { item: 42 }, { retry: 3 });`, then build the skill with `npx skillunit proof --write` and run `npx skillunit lint`:

```
1) skill/features/retries.md:45  retry-idempotent-only  breaks `retry-idempotent-only`: `.post("https://api.example.com/orders", { item: 42 }, { ret…` matches its `Check` (features/retries.md:48)
```

### A default changed

In `src/timeout.ts`, change `DEFAULT_TIMEOUT = 10_000` to `5_000`, and change nothing else. The fact `default-timeout` says a request waits 10 seconds, and its test builds that sentence from the constant. Run `npx skillunit proof`. The tests pass, and it ends with:

```
  skill/features/timeouts.md
    proof  ✗ skill/features/timeouts.md:15  this line is not what the build gives: the build has `| 'timeout' | number (ms) | '5_000' | …`, the skill has `| 'timeout' | number (ms) | '10_000' | …`. …
             from the source, skill-src/features/timeouts.md:15
    default-timeout  fact
      proof  ✓ proved by a test, src/tinyfetch.test.ts:327
      proof  ✗ skill/features/timeouts.md:42  this line is not what the build gives: the build has `Value: 5 seconds ('timeout: 5_000'), for every method.`, the skill has `Value: 10 seconds ('timeout: 10_000'), for every method.`. Run `skillunit proof --write` to update the skill. To change this text, change where it comes from: the skill folder is built.
               from the test of `default-timeout`, src/tinyfetch.test.ts:327
    timeout-off  fact
      proof  ✓ proved by a test, src/tinyfetch.test.ts:370
    never-disable-timeout  rule
      proof  – declared, no test, src/tinyfetch.skill.test.ts:121
    cancel-with-signal  fact
      proof  ✓ proved by a test, src/tinyfetch.test.ts:388

  16 units · 13 proved by a test · 3 declared without one · 5 values in prose · 1 file out of date

Failed
  skill/features/timeouts.md › proof skill/features/timeouts.md:15
  skill/features/timeouts.md › default-timeout › proof skill/features/timeouts.md:42

FAILED  proof 2 errors, 0 warnings
```

The first finding is the row of the options table whose `Default` comes from the same test. If 5 seconds is the new default, run `npx skillunit proof --write`, and proof passes. With a key, `npx skillunit check` then asks the question about the default with 5 seconds as its right option, and it passes.

### A rule too vague to follow

This one asks the decision model, so it needs a key (see [Quick start](#quick-start)). In `src/tinyfetch.skill.test.ts`, replace the `do` of `retry-idempotent-only` with the one from [Test](#test), build the skill with `npx skillunit proof --write`, then run `npx skillunit test`. It fails `retry-methods` and `put-may-retry`. The output ends with:

```
Failed
  skill/features/retries.md › retry-idempotent-only › src/tinyfetch.skill.test.ts:60  retry-methods
  skill/features/retries.md › retry-idempotent-only › src/tinyfetch.skill.test.ts:60  put-may-retry

FAILED  test 14/16 passed
```

Every experiment is also an [acceptance scenario](https://github.com/Elecash/skillunit/blob/main/apps/tinyfetch-e2e/src/scenarios.ts), so CI fails when SkillUnit stops reporting what one of them shows here.

## Check the examples of a skill

`skillunit.yaml` says how lint checks the code in a skill. `init` writes the `ts` entry when the project has a `tsconfig.json`:

```yaml
skill: ./skills/my-skill
examples:
  ts: { tsconfig: ./tsconfig.json }   # ts, tsx, js and jsx, with the project's tsc
  sh: { command: "bash -n {file}" }   # any other language: a command that must exit 0
```

Most examples in a skill use names they never declare, and fail with "Cannot find name". Declare those names once in a `Setup:` block; lint puts it in front of every example of that language in the file:

````md
Setup:

```ts
import { tf } from "tinyfetch";
declare const user: { id: number };
```
````

A complete example may import and declare again what the `Setup` declares: its own declaration wins, so the same skill can mix fragments with examples meant to be copied whole. A file with no `Setup` of its own uses the one of `SKILL.md`, so one block can cover a whole skill. This works in any skill, written in units or not. A block that cannot compile on purpose gets `no-check` after its language (```` ```ts no-check ````), and `lint: { off: [length] }` in `skillunit.yaml` turns a rule off. The [configuration](https://github.com/Elecash/skillunit/blob/main/docs/configuration.md) lists every key.

## Docs and license

- [Style guide](https://github.com/Elecash/skillunit/blob/main/docs/style-guide.md): how to write a skill in units, and its index
- [Questions](https://github.com/Elecash/skillunit/blob/main/docs/questions.md): where the questions for the decision model go, and how to write one that fails when it should
- [Proof](https://github.com/Elecash/skillunit/blob/main/docs/proof.md): units declared in tests, the source and its slots, which tests `proof.run` runs
- [Configuration](https://github.com/Elecash/skillunit/blob/main/docs/configuration.md): `skillunit.yaml`, the key, decision models
- [Command line](https://github.com/Elecash/skillunit/blob/main/docs/cli.md): commands, options, reporters, exit codes
- [CI](https://github.com/Elecash/skillunit/blob/main/docs/ci.md): the workflow, pull requests from forks, what a run costs

MIT © Raúl Jiménez
