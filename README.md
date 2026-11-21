# SkillUnit

[![CI](https://github.com/Elecash/skillunit/actions/workflows/ci.yml/badge.svg)](https://github.com/Elecash/skillunit/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/skillunit)](https://www.npmjs.com/package/skillunit)

The API changes, the skill does not, and agents keep writing code for the version the skill describes. Nothing fails, so nobody notices.

SkillUnit checks that an agent skill still matches the code it describes. It is for skills that describe code, such as a library, an API, a CLI or an SDK.

- **Each CI job takes under a minute.** In this repository's [CI run of 2026-11-21](https://github.com/Elecash/skillunit/actions/runs/44881643790), the job that type-checks, builds, runs the tests, the dry check and the e2e scenarios took 44 seconds, and the job that asks the decision model took 25.
- **Lint and sync need no model and no key.** They run on pull requests from forks, which get no secrets.
- **The test layer costs a fraction of a cent per run.** See [what a run costs](https://github.com/Elecash/skillunit/blob/main/docs/ci.md#what-a-run-costs).

Here is `skillunit check` on [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch), the sample library in this repository, after one change to its code, one to an example and one to its prose (the per-file tables at the top of the output are left out):

```
Failures

  1) skill/features/clients.md:28  -  breaks `body-as-object`: `JSON.stringify` matches its `Check` (features/requests.md:84)

  2) skill/features/errors.md:13  check-with-is-http-error  `src/errors.ts#isHttpError` changed since the unit was last reviewed; read the code against the unit, edit the unit if it is wrong, then accept it with `skillunit review`

  3) specs/retries.yaml:4  post-no-retry
     skill:     skill/features/retries.md   unit: retry-idempotent-only
     scenario:  An order is created with `tf.post`, and the network drops now and then.
     question:  Should the agent pass `retry` to that call?
     expected:  no-retry
     got:       no-retry · confidence 0.28, threshold 0.50 · right answer, too little confidence
                no-retry 52% · none 29% · retry 19%
     phrasings: 0.52  0.55 (probability of "no-retry" for each; the median decides)

  4) specs/retries.yaml:15  patch-no-retry
     skill:     skill/features/retries.md   unit: retry-idempotent-only
     scenario:  A user profile is updated with `tf.patch`, and the API sometimes answers 503.
     question:  Should the agent pass `retry` to that call?
     expected:  no-retry
     got:       no-retry · confidence 0.34, threshold 0.50 · right answer, too little confidence
                no-retry 56% · none 25% · retry 19%

FAILED  lint 1 error, 0 warnings · sync 1 unit to review · test 13/15 passed
```

## How it works

Each instruction of a skill is a unit: a `### rule:`, `### decision:` or `### fact:` heading followed by labelled paragraphs, with a footer that the tools read. The [style guide](https://github.com/Elecash/skillunit/blob/main/docs/style-guide.md) describes the format. SkillUnit runs three layers over the units.

**Lint** catches a skill that has drifted from the API or from its own rules: an example that no longer compiles, an example that breaks a rule, a malformed unit, a broken link. It type-checks every TypeScript and JavaScript example with the project's own `tsc`, and runs each rule's `Check` regex, such as ``Check: forbid `/JSON\.stringify/` in ts``, over every example of the skill.

**Sync** catches a unit whose code changed since someone last checked the unit against it. Each unit names its code with `Source:`, such as `Source: src/errors.ts#isHttpError`, and `skillunit.lock`, committed next to `skillunit.yaml`, keeps a fingerprint of that code from the last review. Comments and formatting do not count, and with `#isHttpError` only that declaration does. `skillunit review` shows the diff next to each unit it reports, and accepting a unit writes its new fingerprint to the lock. Sync needs no git history.

**Test** catches text that does not settle a decision, such as a sentence that contradicts a rule or a rule too vague to follow. A spec is a YAML list of closed questions about one file of the skill. A decision model reads the file and gives each answer a probability, and a test passes when the expected answer wins with enough confidence. In failure 3 above, the model still picks `no-retry`, but a sentence saying a POST is safe to retry pulls it down to 52%, so the test fails:

```yaml
- id: post-no-retry
  unit: retry-idempotent-only
  scenario:
    - An order is created with `tf.post`, and the network drops now and then.
    - A payment is sent with `tf.post` to an API that sometimes answers 503.
  question: Should the agent pass `retry` to that call?
  options:
    retry: Yes, pass `retry` so the request survives a dropped connection or a 503
    no-retry: No, leave `retry` off for this method
  expect: no-retry
```

SkillUnit checks what a skill says. It does not check whether an agent follows it.

## Who it is for

All three layers apply to a skill that describes code. A skill with no code, such as a process, a checklist or a writing guide, has no `Source` and no examples to compile, so sync and the type-check have nothing to do. Only the test layer and the format rules of lint work on it.

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

**1. An option renamed in the code.** In `src/types.ts`, rename the option `retryDelay` to `backoff`, then run `npx skillunit lint`. The skill still shows `retryDelay`:

```
1) skill/features/retries.md:19  -  does not type-check: TS2353 Object literal may only specify known properties, and 'retryDelay' does not exist in type 'RequestOptions'.
```

**2. An example that breaks its own rule.** In `skill/features/retries.md`, change the `Right` example of `retry-idempotent-only` to `await tf.post("https://api.example.com/orders", { item: 42 }, { retry: 3 });`, then run `npx skillunit lint`:

```
1) skill/features/retries.md:33  retry-idempotent-only  breaks `retry-idempotent-only`: `.post("https://api.example.com/orders", { item: 42 }, { ret…` matches its `Check` (features/retries.md:44)
```

**3. A comment reworded.** In `src/timeout.ts`, reword the comment above `withTimeout`, then run `npx skillunit sync`. A comment is not a change:

```
8 units with a Source: 8 in sync, 0 stale, 0 new

OK  sync ok
```

**4. A default changed.** In `src/timeout.ts`, change `DEFAULT_TIMEOUT = 10_000` to `5_000`, then run `npx skillunit sync`:

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

**5. A sentence that contradicts a rule.** This one asks the decision model, so it needs a key (see [Quick start](#quick-start)). In `skill/features/retries.md`, after "It never retries a 4xx status or a timeout.", add "Retrying is safe for every method, POST included, so turn `retry` on wherever a request may fail.", then run `npx skillunit test`. It fails `post-no-retry` and `patch-no-retry`, as in failures 3 and 4 above:

```
FAILED  test 13/15 passed
```

Every experiment is also an [acceptance scenario](https://github.com/Elecash/skillunit/blob/main/apps/tinyfetch-e2e/src/scenarios.ts), so CI fails when SkillUnit stops reporting what one of them shows here.

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

The test layer needs a decision model:

| Decision model | Adapter | Models | Key |
| --- | --- | --- | --- |
| [TypeSafe](https://typesafe.ai) | `typesafe`, the default | `jev-latest`, or any model TypeSafe lists | `TYPESAFE_API_KEY` |
| Your own | a module that exports a `DecisionModel` | any | [see the configuration](https://github.com/Elecash/skillunit/blob/main/docs/configuration.md#a-decision-model-of-your-own) |

Put the key in the environment, or in a `.env` file next to `skillunit.yaml` or at the root of the repository. Then run the three layers:

```sh
npx skillunit check
```

## Let your agent write the skill and the specs

SkillUnit ships a skill that teaches an agent to write a skill in units, to write its examples and specs, and to act on a report. Install it with [skills.sh](https://skills.sh):

```sh
npx skills add https://github.com/Elecash/skillunit --skill skillunit
```

Then ask the agent, for example: "Rewrite `skills/my-skill` in units and add SkillUnit specs for it."

## Docs and license

- [Style guide](https://github.com/Elecash/skillunit/blob/main/docs/style-guide.md): how to write a skill in units, and its index
- [Writing specs](https://github.com/Elecash/skillunit/blob/main/docs/writing-specs.md): the spec format, and how to write a test that fails when it should
- [Configuration](https://github.com/Elecash/skillunit/blob/main/docs/configuration.md): `skillunit.yaml`, the key, decision models
- [Command line](https://github.com/Elecash/skillunit/blob/main/docs/cli.md): commands, options, reporters, exit codes
- [CI](https://github.com/Elecash/skillunit/blob/main/docs/ci.md): the workflow, pull requests from forks, what a run costs

MIT © Raúl Jiménez
