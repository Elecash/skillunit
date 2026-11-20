# SkillUnit

SkillUnit checks that an agent skill still matches the code it describes.

It runs three layers over a skill written in small Markdown units: [lint, sync and test](#how-it-works). Here is `skillunit check` on [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch), the sample library in this repository, after one change to its code, one to an example and one to its prose (the per-file tables at the top of the output are left out):

```
Failures

  1) skill/features/clients.md:28  -  breaks `body-as-object`: `JSON.stringify` matches its `Check` (features/requests.md:84)

  2) skill/features/errors.md:13  check-with-is-http-error  `src/errors.ts` changed since 8691035 and this unit did not; review it, then edit it or add `Skill-reviewed: check-with-is-http-error` to a commit message

  3) specs/retries.yaml:4  post-no-retry
     skill:     skill/features/retries.md   unit: retry-idempotent-only
     scenario:  A payment is sent with `tf.post` to an API that sometimes answers 503.
     question:  Should the agent pass `retry` to that call?
     expected:  no-retry
     got:       retry · confidence 0.02, threshold 0.50 · wrong answer, borderline: the next run may pass it
                retry 35% · none 34% · no-retry 31%
     phrasings: 0.32  0.31 (probability of "no-retry" for each; the median decides)

Borderline  passed, but within 0.13 of the threshold; the next run may fail them
  specs/retries.yaml:15  patch-no-retry  no-retry, confidence 0.52, threshold 0.50

FAILED  lint 1 error, 0 warnings · sync 1 unit to review · test 14/15 passed (2 borderline)
```

## How it works

Each instruction of a skill is a unit: a `### rule:`, `### decision:` or `### fact:` heading followed by labelled paragraphs, with a footer that the tools read. The [style guide](https://github.com/Elecash/skillunit/blob/main/docs/style-guide.md) describes the format.

### Lint

Lint catches a skill that has drifted from the API or from its own rules: an example that no longer compiles, an example that breaks a rule, a malformed unit, a broken link. It type-checks every TypeScript and JavaScript example with the project's own `tsc`, and runs each rule's `Check` regex over every example of the skill. In tinyfetch, the rule `body-as-object` ends with:

```md
Check: forbid `/JSON\.stringify/` in ts
```

so an example in another file that called `JSON.stringify` got:

```
skill/features/clients.md:28  -  breaks `body-as-object`: `JSON.stringify` matches its `Check` (features/requests.md:84)
```

### Sync

Sync catches a unit whose code changed while the unit did not. Each unit names its code with `Source:`, such as `Source: src/errors.ts#isHttpError`. Sync compares HEAD with its merge base on the main branch and reports every unit whose source file changed. Editing the unit, or a `Skill-reviewed: <unit-id>` trailer in a commit message, marks it reviewed.

```
skill/features/errors.md:13  check-with-is-http-error  `src/errors.ts` changed since 8691035 and this unit did not; review it, then edit it or add `Skill-reviewed: check-with-is-http-error` to a commit message
```

### Test

The test layer catches text that does not settle a decision, such as a sentence that contradicts a rule or a rule too vague to follow. A spec is a YAML list of closed questions about one file of the skill. A decision model reads the file and gives each answer a probability, and a test passes when the expected answer wins with enough confidence. This test of tinyfetch failed (failure 3 above) once a sentence saying a POST is safe to retry was added to the prose:

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

```
expected:  no-retry
got:       retry · confidence 0.02, threshold 0.50 · wrong answer, borderline: the next run may pass it
           retry 35% · none 34% · no-retry 31%
```

SkillUnit checks what a skill says. It does not check whether an agent follows it.

## Quick start

```sh
npm install --save-dev skillunit
npx skillunit init skills/my-skill
```

`init` writes `skillunit.yaml` and a first spec. Lint and sync need no model and no key, so two of the three layers work at once:

```sh
npx skillunit lint
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
