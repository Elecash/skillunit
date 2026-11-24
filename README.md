# SkillUnit

[![CI](https://github.com/Elecash/skillunit/actions/workflows/ci.yml/badge.svg)](https://github.com/Elecash/skillunit/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/skillunit)](https://www.npmjs.com/package/skillunit)

The API changes, the skill does not, and agents keep writing code for the version the skill describes. Nothing fails, so nobody notices.

SkillUnit ties the instructions of an agent skill to the tests of the code they describe, and fails CI when a test and the skill disagree. It is for skills that describe code, such as a library, an API, a CLI or an SDK.

It checks a skill in three layers:

- **Lint** type-checks the examples of the skill against the API, with the project's own TypeScript compiler, and checks them against the skill's own rules. It reports an example that no longer compiles, an example that breaks a rule and a broken link.
- **Proof** builds the instructions that a test can check from the test itself. The test declares the instruction with `unit()`, its sentence is built from the code where the code has the value, and the skill is built from a source folder and those tests. When the code changes, the built skill changes, and `check` fails until the skill in the repository says the same.
- **Test** asks a decision model closed questions about the skill. A test fails when the text does not settle the answer: a sentence contradicts a rule, or a rule is too vague to follow.

`skillunit check` runs the three and prints each unit of the skill with what each layer found about it. On [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch), with `--dry-run`, which sends the tests nowhere and needs no key, cut to two of its six files:

```
Lint  skill
  ✓ 6 files, all clean
  12 units · 19 examples type-checked with TypeScript 5.6.3

Units  proof ran `npx vitest run` in 0.4 s, exit 0 · test dry run: nothing sent

  skill/SKILL.md
    test   · specs/skill.yaml:13  which-file-for-retries  ready
    await-every-request  rule
      proof  ✓ from a test src/tinyfetch.test.ts:56
      test   · specs/skill.yaml:4  await-the-call  ready

  skill/features/retries.md
    retry-defaults  fact
      proof  ✓ from a test src/tinyfetch.test.ts:185
      test   · specs/retries.yaml:51  retry-delay-default  ready
    what-is-retried  fact
      proof  ✓ from a test src/tinyfetch.test.ts:166
      test   –
    retry-idempotent-only  rule
      proof  – by hand
      test   · specs/retries.yaml:4  post-no-retry  ready
      test   · specs/retries.yaml:15  patch-no-retry  ready
      test   · specs/retries.yaml:26  retry-methods  ready
      test   · specs/retries.yaml:36  put-may-retry  ready
      test   · specs/retries.yaml:45  get-may-retry  ready
  …

  12 units · 6 proof and test · 3 proof only · 3 test only · 0 not covered
  12 units · 9 from tests · 3 by hand · 3 values in prose
  16 tests

OK  lint ok · proof ok · test dry run ok, 16 tests ready
```

A `–` is a layer with nothing on that unit, and `by hand` a unit written in the source rather than declared in a test. A unit with neither proof nor a test reads `not covered`.

What it costs to run:

- **A check takes seconds.** Lint and proof take 1 to 2 seconds per skill, plus the time of the project's tests, which proof runs. The decision model answers a spec, a file of tests, in under a second, however many tests it holds: 58 tests in 8 specs take about 1.5 seconds on TypeSafe and 3 on OpenAI.
- **Lint and proof need no model and no key.** They run on pull requests from forks, which get no secrets.
- **The test layer costs a fraction of a cent per run.** See [what a run costs](https://github.com/Elecash/skillunit/blob/main/docs/ci.md#what-a-run-costs).

## Quick start

```sh
npm install --save-dev skillunit
npx skillunit init skills/my-skill
```

`init` writes `skillunit.yaml` and a first spec, and lint works at once:

```sh
npx skillunit lint
```

Proof builds the skill from a source folder and the units your tests declare. Move the skill to a source folder, set `source` and `proof.run` in `skillunit.yaml`, wrap the tests that check what a unit says in `unit()` from `skillunit/vitest`, and put `{{unit:<id>}}` in the source where each one goes. Then build the skill, and commit both folders:

```yaml
skill: ./skills/my-skill
source: ./skills-src/my-skill
proof:
  run: "npx vitest run"
```

```sh
npx skillunit proof --write
```

[Proof](https://github.com/Elecash/skillunit/blob/main/docs/proof.md) has the `unit()` API, the slots, and the JSON a test in another language writes.

SkillUnit ships a skill that teaches an agent to write a skill in units, to write its examples and specs, and to act on a report. Install it with [skills.sh](https://skills.sh):

```sh
npx skills add https://github.com/Elecash/skillunit --skill skillunit
```

Then ask the agent, for example: "Rewrite `skills/my-skill` in units and add SkillUnit specs for it."

The test layer needs a decision model:

| Decision model | Adapter | Models | Key |
| --- | --- | --- | --- |
| [TypeSafe](https://typesafe.ai) | `typesafe`, the default | `jev-latest`, or any model TypeSafe lists | `TYPESAFE_API_KEY` |
| [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions) | `openai` | `gpt-6-luna` | `OPENAI_API_KEY` |
| Your own | a module that exports a `DecisionModel` | any | [see the configuration](https://github.com/Elecash/skillunit/blob/main/docs/configuration.md#a-decision-model-of-your-own) |

Pick one with `model: { provider: openai }` in `skillunit.yaml`, or `--provider openai` for a single run. Models can answer the same test differently (OpenAI's is more decisive than Jev), so pick one and write your tests for it. Put that provider's key in the environment, or in a `.env` file next to `skillunit.yaml` or at the root of the repository. Then run every layer:

```sh
npx skillunit check
```

## How it works

### Units

Each instruction of a skill is a unit: a heading with its kind and its id, labelled paragraphs that the agent reads, and an optional `Check` that lint reads. There are three kinds. The examples are from [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch/skill), the decision without its optional labels, and the [style guide](https://github.com/Elecash/skillunit/blob/main/docs/style-guide.md) describes the format.

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

**An example breaks a rule.** In `skill/features/retries.md`, in the `Right` example of the rule above:

```diff
-await tf.get("https://api.example.com/users", { retry: 3 });
+await tf.post("https://api.example.com/orders", { item: 42 }, { retry: 3 });
```

```
1) skill/features/retries.md:45  retry-idempotent-only  breaks `retry-idempotent-only`: `.post("https://api.example.com/orders", { item: 42 }, { ret…` matches its `Check` (features/retries.md:48)
```

### Proof

A unit that a test can check is declared in that test, and the skill is built from a source folder and the tests. A unit no test can check, such as the rule above, which is about what a server does with a repeated request, is written in the source by hand. `skillunit proof` runs the tests through `proof.run`, builds the skill, and compares it with the skill folder. [Proof](https://github.com/Elecash/skillunit/blob/main/docs/proof.md) describes `unit()`, the slots and the settings.

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
      proof  ✓ from a test src/tinyfetch.test.ts:215
      proof  ✗ skill/features/timeouts.md:42  this line is not what the build gives: the build has `Value: 5 seconds ('timeout: 5_000'), for every method.`, the skill has `Value: 10 seconds ('timeout: 10_000'), for every method.`. The skill is built: edit the file this line comes from, then run `skillunit proof --write`
               from the test of `default-timeout`, src/tinyfetch.test.ts:215
```

The options table, which shows the default through `{{value:default-timeout.ms}}`, fails too. `skillunit proof --write` rewrites both, and the change to the skill goes in the same pull request as the change to the code.

### Test

A spec is a YAML list of closed questions about one file of the skill. A decision model reads the file and gives each answer a probability, and a test passes when the expected answer wins with a high enough probability. [Writing specs](https://github.com/Elecash/skillunit/blob/main/docs/writing-specs.md) describes the format.

**A sentence contradicts a rule.** In `skill-src/features/retries.md`, the source of the skill, in the prose above the rules:

```diff
-Which failures it repeats, and how long it waits, are in the rules below.
+The server never applies the same request twice: retrying is safe for every method, and `retry` belongs on POST and PATCH calls as much as on GET.
```

The model still picks `no-retry` for a POST, but the new sentence pulls it down to 47%, under the threshold, so the test fails. The PATCH test passes at 54%, close enough to the threshold to be marked borderline:

```
  skill/features/retries.md
    retry-idempotent-only  rule
      test   ✗ specs/retries.yaml:4  post-no-retry  no-retry 0.47
               scenario:  A payment is sent with `tf.post` to an API that sometimes answers 503.
               question:  Should the agent pass `retry` to that call?
               expected:  no-retry
               got:       no-retry · probability 0.47, threshold 0.50 · right answer, under the threshold, borderline: the next run may pass it
                          no-retry 47% · none 30% · retry 23%
               phrasings: 0.56  0.47 (probability of "no-retry" for each; the median decides)
      test   ~ specs/retries.yaml:15  patch-no-retry  no-retry 0.54
               probability 0.54, threshold 0.50 · borderline: the next run may fail it
```

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

Then break one thing at a time. Each experiment starts from a clean tree, and `git checkout .` undoes it. The first three need no key. The skill people write is in `skill-src`; `skill` is built from it.

### An option renamed in the code

In `src/types.ts`, rename the option `retryDelay` to `backoff`, then run `npx skillunit lint`. The skill still shows `retryDelay`:

```
1) skill/features/retries.md:19  -  does not type-check: TS2353 Object literal may only specify known properties, and 'retryDelay' does not exist in type 'RequestOptions'.
```

### An example that breaks its own rule

In `skill-src/features/retries.md`, change the `Right` example of `retry-idempotent-only` to `await tf.post("https://api.example.com/orders", { item: 42 }, { retry: 3 });`, then build the skill with `npx skillunit proof --write` and run `npx skillunit lint`:

```
1) skill/features/retries.md:45  retry-idempotent-only  breaks `retry-idempotent-only`: `.post("https://api.example.com/orders", { item: 42 }, { ret…` matches its `Check` (features/retries.md:48)
```

### A default changed

In `src/timeout.ts`, change `DEFAULT_TIMEOUT = 10_000` to `5_000`, and change nothing else. The fact `default-timeout` says a request waits 10 seconds, and its test builds that sentence from the constant. Run `npx skillunit proof`. The tests pass, and it ends with:

```
  skill/features/timeouts.md
    proof  ✗ skill/features/timeouts.md:13  this line is not what the build gives: …
             from the source, skill-src/features/timeouts.md:13
    default-timeout  fact
      proof  ✓ from a test src/tinyfetch.test.ts:215
      proof  ✗ skill/features/timeouts.md:42  this line is not what the build gives: the build has `Value: 5 seconds ('timeout: 5_000'), for every method.`, the skill has `Value: 10 seconds ('timeout: 10_000'), for every method.`. The skill is built: edit the file this line comes from, then run `skillunit proof --write`
               from the test of `default-timeout`, src/tinyfetch.test.ts:215
    never-disable-timeout  rule
      proof  – by hand

  12 units · 9 from tests · 3 by hand · 3 values in prose · 1 file out of date

Failed
  skill/features/timeouts.md › proof skill/features/timeouts.md:13
  skill/features/timeouts.md › default-timeout › proof skill/features/timeouts.md:42

FAILED  proof 2 errors, 0 warnings
```

The first finding is the options table, whose `Default` column comes from the same test. If 5 seconds is the new default, run `npx skillunit proof --write`, and proof passes.

### A sentence that contradicts a rule

This one asks the decision model, so it needs a key (see [Quick start](#quick-start)). In `skill-src/features/retries.md`, replace the sentence that points to the rules with the one from [Test](#test), build the skill with `npx skillunit proof --write`, then run `npx skillunit test`. It fails `post-no-retry`, and `patch-no-retry` passes close to its threshold. The output ends with:

```
Failed
  skill/features/retries.md › retry-idempotent-only › specs/retries.yaml:4  post-no-retry

FAILED  test 15/16 passed (2 borderline)
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
- [Writing specs](https://github.com/Elecash/skillunit/blob/main/docs/writing-specs.md): the spec format, and how to write a test that fails when it should
- [Configuration](https://github.com/Elecash/skillunit/blob/main/docs/configuration.md): `skillunit.yaml`, the key, decision models
- [Command line](https://github.com/Elecash/skillunit/blob/main/docs/cli.md): commands, options, reporters, exit codes
- [CI](https://github.com/Elecash/skillunit/blob/main/docs/ci.md): the workflow, pull requests from forks, what a run costs

MIT © Raúl Jiménez
