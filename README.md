# SkillUnit

[![CI](https://github.com/Elecash/skillunit/actions/workflows/ci.yml/badge.svg)](https://github.com/Elecash/skillunit/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/skillunit)](https://www.npmjs.com/package/skillunit)

The API changes, the skill does not, and agents keep writing code for the version the skill describes. Nothing fails, so nobody notices.

SkillUnit ties the instructions of an agent skill to the tests of the code they describe, and fails CI when a test and the skill disagree. It is for skills that describe code, such as a library, an API, a CLI or an SDK.

It checks a skill in three layers:

- **Lint** type-checks the examples of the skill against the API, with the project's own TypeScript compiler, and checks them against the skill's own rules. It reports an example that no longer compiles, an example that breaks a rule and a broken link.
- **Proof** reads the project's own test run. A test whose title carries `[skill:<id>]` proves that instruction, and when the test fails, proof names the instruction. A test can also produce an instruction's example, which SkillUnit copies into the skill, so the example is code that ran.
- **Test** asks a decision model closed questions about the skill. A test fails when the text does not settle the answer: a sentence contradicts a rule, or a rule is too vague to follow.

What it costs to run:

- **Each CI job takes under a minute.** In this repository, the job that type-checks, builds, runs the tests, the dry check and the e2e scenarios took 44 seconds, and the job that asks the decision model took 25.
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

Proof reads the JUnit report of the project's tests. Point `proof.reports` in `skillunit.yaml` at it, with `require: false` to start one unit at a time, run the tests, then proof. [Proof](https://github.com/Elecash/skillunit/blob/main/docs/proof.md) shows the reporter for Vitest, Jest and pytest.

```yaml
proof:
  reports: ./reports/junit.xml
  require: false
```

```sh
npx vitest run --reporter=default --reporter=junit --outputFile.junit=reports/junit.xml
npx skillunit proof
```

SkillUnit ships a skill that teaches an agent to write a skill in units, to write its examples and specs, and to act on a report. Install it with [skills.sh](https://skills.sh):

```sh
npx skills add https://github.com/Elecash/skillunit --skill skillunit
```

Then ask the agent, for example: "Rewrite `skills/my-skill` in units and add SkillUnit specs for it."

The test layer needs a decision model:

| Decision model | Adapter | Models | Key |
| --- | --- | --- | --- |
| [TypeSafe](https://typesafe.ai) | `typesafe`, the default | `jev-latest`, or any model TypeSafe lists | `TYPESAFE_API_KEY` |
| Your own | a module that exports a `DecisionModel` | any | [see the configuration](https://github.com/Elecash/skillunit/blob/main/docs/configuration.md#a-decision-model-of-your-own) |

Put the key in the environment, or in a `.env` file next to `skillunit.yaml` or at the root of the repository. Then run every layer:

```sh
npx skillunit check
```

## How it works

### Units

Each instruction of a skill is a unit: a heading with its kind and its id, labelled paragraphs that the agent reads, and a footer (`Applies`, `Check`, `Proof`) that the tools read. There are three kinds. The examples are from [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch/skill), the decision without its optional labels, and the [style guide](https://github.com/Elecash/skillunit/blob/main/docs/style-guide.md) describes the format.

**A rule** is a constraint on what the agent writes.

````md
### rule: retry-idempotent-only

When: a request may be retried.

Do: enable `retry` only for GET, HEAD, PUT and DELETE.

Right:

```ts
await tf.get("https://api.example.com/users", { retry: 3 });
```

Applies: retries, post, patch

Check: forbid `/\.(post|patch)\([^)]*retry/` in ts

Proof: none, it is about what a server does with a repeated request, which the tests of tinyfetch cannot see
````

**A decision** is a choice between paths, each with the condition that selects it.

```md
### decision: one-client-per-api

When: the code makes several requests to the same API.

Decide: whether to create a client.

- **shared** — the requests share a base URL or headers: create one client with `create` and reuse it.

- **direct** — one request, or requests to unrelated hosts: call `tf` with full URLs.

Applies: clients
```

**A fact** is a value the agent must state exactly.

```md
### fact: default-timeout

When: the user asks how long a request waits by default.

Value: 10 seconds (`timeout: 10_000`), for every method.

Unknown: tinyfetch has no separate connect timeout; say so instead of inventing one.

Applies: timeouts
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
1) skill/features/retries.md:49  retry-idempotent-only  breaks `retry-idempotent-only`: `.post("https://api.example.com/orders", { item: 42 }, { ret…` matches its `Check` (features/retries.md:54)
```

### Proof

Proof reads the JUnit report of the project's test run; SkillUnit never runs the tests. A test proves a unit when its title carries `[skill:<unit id>]`. A unit no test can prove says why, with `Proof: none` and a reason, as the rule above does. [Proof](https://github.com/Elecash/skillunit/blob/main/docs/proof.md) describes the tags, the settings and how to wire Vitest, Jest and pytest.

**The code changes, and a fact is now false.** tinyfetch's skill says a retry waits 300 ms, in the fact `retry-defaults`, and a test asserts it:

```ts
it('does not retry by default, and waits 300 ms, then twice as long each time [skill:retry-defaults]', async () => {
  expect(DEFAULT_RETRY_DELAY).toBe(300);
  // …
});
```

In `src/retry.ts`:

```diff
-export const DEFAULT_RETRY_DELAY = 300;
+export const DEFAULT_RETRY_DELAY = 500;
```

The test fails, and proof names the unit it proves:

```
1) skill/features/retries.md:24  retry-defaults  the test "src/tinyfetch.test.ts › tinyfetch > does not retry by default, and waits 300 ms, then twice as long each time [skill:retry-defaults]" (reports/junit.xml:20) failed: expected 500 to be 300 // Object.is equality. It proves this unit, so the unit may no longer say what the code does
```

A test can also produce an example. A block flagged `proof=<id>` after its language holds the lines between `#region skill:<id>` and `#endregion` in a test, or a file the test wrote. `skillunit proof --write` copies them into the skill, and proof fails when the block and the test no longer agree.

### Test

A spec is a YAML list of closed questions about one file of the skill. A decision model reads the file and gives each answer a probability, and a test passes when the expected answer wins with enough confidence. [Writing specs](https://github.com/Elecash/skillunit/blob/main/docs/writing-specs.md) describes the format.

**A sentence contradicts a rule.** In `skill/features/retries.md`, in the prose above the rules:

```diff
-Which failures it repeats, and how long it waits, are in the rules below.
+Which failures it repeats, and how long it waits, are in the rules below. tinyfetch sends an `Idempotency-Key` header with every POST and PATCH, and repeats it on each retry, so the server never applies the same request twice: retrying is safe for every method, and `retry` belongs on POST and PATCH calls as much as on GET.
```

The model still picks `no-retry` for a PATCH, but the new sentence pulls it down to 55%, so the test fails:

```
2) specs/retries.yaml:15  patch-no-retry
   skill:     skill/features/retries.md   unit: retry-idempotent-only
   scenario:  A user profile is updated with `tf.patch`, and the API sometimes answers 503.
   question:  Should the agent pass `retry` to that call?
   expected:  no-retry
   got:       no-retry · confidence 0.33, threshold 0.50 · right answer, too little confidence
              no-retry 55% · retry 23% · none 22%
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
npx vitest run
npx skillunit check --dry-run
```

`vitest run` writes the report proof reads, in `reports/junit.xml`. The check ends with:

```
OK  lint ok · proof ok · test dry run ok, 15 tests ready
```

Then break one thing at a time. Each experiment starts from a clean tree, and `git checkout .` undoes it. The first three need no key.

### An option renamed in the code

In `src/types.ts`, rename the option `retryDelay` to `backoff`, then run `npx skillunit lint`. The skill still shows `retryDelay`:

```
1) skill/features/retries.md:19  -  does not type-check: TS2353 Object literal may only specify known properties, and 'retryDelay' does not exist in type 'RequestOptions'.
```

### An example that breaks its own rule

In `skill/features/retries.md`, change the `Right` example of `retry-idempotent-only` to `await tf.post("https://api.example.com/orders", { item: 42 }, { retry: 3 });`, then run `npx skillunit lint`:

```
1) skill/features/retries.md:49  retry-idempotent-only  breaks `retry-idempotent-only`: `.post("https://api.example.com/orders", { item: 42 }, { ret…` matches its `Check` (features/retries.md:54)
```

### A default changed

In `src/timeout.ts`, change `DEFAULT_TIMEOUT = 10_000` to `5_000`. The fact `default-timeout` says a request waits 10 seconds, and a test asserts it. Run `npx vitest run`, which fails that test, then `npx skillunit proof`:

```
1) skill/features/timeouts.md:38  default-timeout  the test "src/tinyfetch.test.ts › tinyfetch > times out after 10 seconds when the code sets nothing [skill:default-timeout]" (reports/junit.xml:22) failed: expected 5000 to be 10000 // Object.is equality. It proves this unit, so the unit may no longer say what the code does
```

If 5 seconds is the new default, edit the `Value` of `default-timeout` and the test's assertion together, run the tests again, and proof passes.

### A sentence that contradicts a rule

This one asks the decision model, so it needs a key (see [Quick start](#quick-start)). In `skill/features/retries.md`, add the sentence about the `Idempotency-Key` header from [Test](#test), then run `npx skillunit test`. It fails `patch-no-retry`, and `post-no-retry` sits near its threshold, so it fails on some runs and not on others:

```
FAILED  test 13/15 passed (1 borderline)
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
