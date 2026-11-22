# SkillUnit

[![CI](https://github.com/Elecash/skillunit/actions/workflows/ci.yml/badge.svg)](https://github.com/Elecash/skillunit/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/skillunit)](https://www.npmjs.com/package/skillunit)

The API changes, the skill does not, and agents keep writing code for the version the skill describes. Nothing fails, so nobody notices.

SkillUnit checks that an agent skill still matches the code it describes. It is for skills that describe code, such as a library, an API, a CLI or an SDK.

It checks a skill in three layers:

- **Lint** type-checks the examples of the skill against the API, with the project's own TypeScript compiler, and checks them against the skill's own rules. It reports an example that no longer compiles, an example that breaks a rule and a broken link.
- **Sync** keeps a fingerprint of the code that each instruction describes. It reports the instructions whose code has changed since someone last reviewed them.
- **Test** asks a decision model closed questions about the skill. A test fails when the text does not settle the answer: a sentence contradicts a rule, or a rule is too vague to follow.

What it costs to run:

- **Each CI job takes under a minute.** In this repository, the job that type-checks, builds, runs the tests, the dry check and the e2e scenarios took 44 seconds, and the job that asks the decision model took 25.
- **Lint and sync need no model and no key.** They run on pull requests from forks, which get no secrets.
- **The test layer costs a fraction of a cent per run.** See [what a run costs](https://github.com/Elecash/skillunit/blob/main/docs/ci.md#what-a-run-costs).

## Quick start

```sh
npm install --save-dev skillunit
npx skillunit init skills/my-skill
```

`init` writes `skillunit.yaml` and a first spec. Lint and sync work at once. Sync needs a lock: read the units once, then let `review --accept-all` write `skillunit.lock`, and commit it.

```sh
npx skillunit lint
npx skillunit review --accept-all
npx skillunit sync
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

Put the key in the environment, or in a `.env` file next to `skillunit.yaml` or at the root of the repository. Then run the three layers:

```sh
npx skillunit check
```

## How it works

### Units

Each instruction of a skill is a unit: a heading with its kind and its id, labelled paragraphs that the agent reads, and a footer (`Applies`, `Check`, `Source`) that the tools read. There are three kinds. The examples are from [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch/skill), the decision without its optional labels, and the [style guide](https://github.com/Elecash/skillunit/blob/main/docs/style-guide.md) describes the format.

**A rule** is a constraint on what the agent writes.

````md
### rule: retry-idempotent-only

When: a request may be retried.

Do: enable `retry` only for GET, HEAD, PUT and DELETE.

Right:

```ts
await tf.get("https://api.example.com/users", { retry: 3 });
```

Wrong:

- Doing: `tf.post("https://api.example.com/orders", { item: 42 }, { retry: 3 })`

  Because: a retried POST can create the same order twice.

Applies: retries, post, patch

Check: forbid `/\.(post|patch)\([^)]*retry/` in ts

Source: src/retry.ts
````

**A decision** is a choice between paths, each with the condition that selects it.

```md
### decision: one-client-per-api

When: the code makes several requests to the same API.

Decide: whether to create a client.

- **shared** — the requests share a base URL or headers: create one client with `create` and reuse it.

- **direct** — one request, or requests to unrelated hosts: call `tf` with full URLs.

Applies: clients

Source: src/client.ts#create
```

**A fact** is a value the agent must state exactly.

```md
### fact: default-timeout

When: the user asks how long a request waits by default.

Value: 10 seconds (`timeout: 10_000`), for every method.

Unknown: tinyfetch has no separate connect timeout; say so instead of inventing one.

Applies: timeouts

Source: src/timeout.ts
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
1) skill/features/retries.md:33  retry-idempotent-only  breaks `retry-idempotent-only`: `.post("https://api.example.com/orders", { item: 42 }, { ret…` matches its `Check` (features/retries.md:44)
```

### Sync

Each unit names its code with `Source`, and `skillunit.lock`, committed next to `skillunit.yaml`, keeps a fingerprint of that code from the last review. Comments and formatting do not count, and with `Source: src/client.ts#create` only that declaration does. Sync needs no git history.

**The code changes, and a unit may no longer be true.** In `src/timeout.ts`:

```diff
-export const DEFAULT_TIMEOUT = 10_000;
+export const DEFAULT_TIMEOUT = 5_000;
```

```
1) skill/features/timeouts.md:38  default-timeout  `src/timeout.ts` changed since the unit was last reviewed; read the code against the unit, edit the unit if it is wrong, then accept it with `skillunit review`
```

Sync cannot tell that the fact above is now false. It reports that the code changed, and a person decides: `skillunit review` shows the diff next to each unit it reports, and accepting a unit writes its new fingerprint to the lock. The same change reports a second unit, `never-disable-timeout`, which names the same file.

### Test

A spec is a YAML list of closed questions about one file of the skill. A decision model reads the file and gives each answer a probability, and a test passes when the expected answer wins with enough confidence. [Writing specs](https://github.com/Elecash/skillunit/blob/main/docs/writing-specs.md) describes the format.

**A sentence contradicts a rule.** In `skill/features/retries.md`, in the prose above the rule:

```diff
-It never retries a 4xx status or a timeout.
+It never retries a 4xx status or a timeout. Retrying is safe for every method, POST included, so turn `retry` on wherever a request may fail.
```

The model still picks `no-retry`, but the new sentence pulls it down to 52%, so the test fails. This is failure 3 of the output at the top of this page:

```
3) specs/retries.yaml:4  post-no-retry
   skill:     skill/features/retries.md   unit: retry-idempotent-only
   scenario:  An order is created with `tf.post`, and the network drops now and then.
   question:  Should the agent pass `retry` to that call?
   expected:  no-retry
   got:       no-retry · confidence 0.28, threshold 0.50 · right answer, too little confidence
              no-retry 52% · none 29% · retry 19%
   phrasings: 0.52  0.55 (probability of "no-retry" for each; the median decides)
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

It ends with:

```
OK  lint ok · sync ok · test dry run ok, 15 tests ready
```

Then break one thing at a time. Each experiment starts from a clean tree, and `git checkout .` undoes it. The first four need no key.

### An option renamed in the code

In `src/types.ts`, rename the option `retryDelay` to `backoff`, then run `npx skillunit lint`. The skill still shows `retryDelay`:

```
1) skill/features/retries.md:19  -  does not type-check: TS2353 Object literal may only specify known properties, and 'retryDelay' does not exist in type 'RequestOptions'.
```

### An example that breaks its own rule

In `skill/features/retries.md`, change the `Right` example of `retry-idempotent-only` to `await tf.post("https://api.example.com/orders", { item: 42 }, { retry: 3 });`, then run `npx skillunit lint`:

```
1) skill/features/retries.md:33  retry-idempotent-only  breaks `retry-idempotent-only`: `.post("https://api.example.com/orders", { item: 42 }, { ret…` matches its `Check` (features/retries.md:44)
```

### A comment reworded

In `src/timeout.ts`, reword the comment above `withTimeout`, then run `npx skillunit sync`. A comment is not a change:

```
8 units with a Source: 8 in sync, 0 stale, 0 new

OK  sync ok
```

### A default changed

In `src/timeout.ts`, change `DEFAULT_TIMEOUT = 10_000` to `5_000`, then run `npx skillunit sync`:

```
1) skill/features/timeouts.md:38  default-timeout  `src/timeout.ts` changed since the unit was last reviewed; read the code against the unit, edit the unit if it is wrong, then accept it with `skillunit review`

2) skill/features/timeouts.md:50  never-disable-timeout  `src/timeout.ts` changed since the unit was last reviewed; read the code against the unit, edit the unit if it is wrong, then accept it with `skillunit review`
```

Sync reports that their code changed, and a person decides whether the units still hold. Here `default-timeout` says a request waits 10 seconds, so it is now false. `npx skillunit review --list` prints the diff of `src/timeout.ts` next to the text of both units, for a person to read. Edit the `Value` of `default-timeout` to 5 seconds (`never-disable-timeout` is still right), then accept both:

```sh
npx skillunit review --accept default-timeout never-disable-timeout
```

```
Updated skillunit.lock: accepted 2 units (default-timeout, never-disable-timeout). Commit it with the change.
```

### A sentence that contradicts a rule

This one asks the decision model, so it needs a key (see [Quick start](#quick-start)). In `skill/features/retries.md`, after "It never retries a 4xx status or a timeout.", add "Retrying is safe for every method, POST included, so turn `retry` on wherever a request may fail.", then run `npx skillunit test`. It fails `post-no-retry` and `patch-no-retry`, as in failures 3 and 4 above:

```
FAILED  test 13/15 passed
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
