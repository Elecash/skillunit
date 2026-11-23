# Configuration

SkillUnit reads `skillunit.yaml` in the folder the command runs in, or the file passed with
`--config`. Every key is optional, command-line options override them, and paths are relative
to the file. Without a file, the skill is the current folder and the specs are in `./specs`.

## Every key

```yaml
skill: ./skill               # folder with SKILL.md (default: the folder of this file)
specs: ./specs               # a spec file, a folder of them, or a list (default: ./specs)
context: "tinyfetch is a small HTTP client for JSON APIs, built on fetch."
model: { provider: typesafe, name: jev-latest }   # or provider: openai, or a module: ./my-model.mjs
thresholds:
  choice: 0.5                # lowest confidence that passes a choice test
  yes: 0.7                   # lowest P(yes) that passes an expected "yes"
  no: 0.3                    # highest P(yes) that passes an expected "no"
  margin: 0.13               # how close to a threshold a verdict is marked borderline
examples:
  ts: { tsconfig: ./tsconfig.json }                 # ts, tsx, js and jsx, with the project's tsc
  sh: { command: "sh -n {file}" }                   # any other language: a command with {file}
lint:
  off: [length]              # lint rules not to report
proof:
  reports: ./reports/junit.xml               # the JUnit XML of the test run: a glob or a list
  examples: ./tmp/skill-proof                # where tests write examples (the default)
  sources: ["src/**/*.test.ts"]              # test files with `#region skill:<id>` examples
  format: "npx --no-install prettier --write {file}"   # run on a skill file after writing it
```

- `skill`: the folder with `SKILL.md`. `--skill` overrides it.
- `specs`: where the [specs](writing-specs.md) are. A test command given paths uses those instead.
- `context`: one sentence about what the skill is for. It is sent with every question and helps
  the reader with the vocabulary of the domain.
- `model`: the decision model, as `{ provider: typesafe | openai, name: <model> }` or the path of
  a module (see below). Without `name`, the provider's default model. A bare name such as
  `model: jev-latest` is an error. `--provider` and `--model` override it.
- `thresholds`: what a test needs to pass, and `margin`, how close to a threshold a verdict is
  marked borderline. The default margin, 0.13, is the largest move measured across six runs of
  SkillUnit's own specs on `typesafe` with no change, among tests whose answer stayed the same.
  `openai` gives the same numbers for the same request every run, so there a borderline verdict
  is one that a small change to the wording or to the order of the options may flip.
- `examples`: how lint checks the skill's code examples. `ts` names a tsconfig: every `ts`, `tsx`,
  `js` and `jsx` example is type-checked with the project's own `tsc` (TypeScript 5 or later,
  found in `node_modules` at or above that tsconfig). The tsconfig should resolve the library's
  name to its source, usually with a `paths` entry. Any other language takes a `command` with
  `{file}` where the example's path goes, run in the folder of `skillunit.yaml`; it must exit 0.
  An example that uses names it does not declare fails with "Cannot find name": declare them
  once in a `Setup:` block, which lint puts in front of every example of that language in the
  file. A file with no `Setup` of its own for a language uses the one of the nearest `SKILL.md`
  above it that has one, so a `Setup` in the root `SKILL.md` covers the skills nested in it too.
  This works in a skill that is not written in units too. A block marked `no-check` after its language is not
  checked. The [style guide](style-guide.md#setup) has the details.
- `lint.off`: lint rules whose findings are not reported, by the name each finding carries in
  the JSON report: `parse`, `structure`, `setup`, `check`, `types`, `command`,
  `index`, `length`, `fence` and `proof`. `length` is the warning about a file above about 300 lines,
  the first to turn off on a skill someone else wrote; `fence` is the warning about a word after
  a fence's language that SkillUnit does not know; `proof` is about the marks of the proof layer
  in the skill, such as a `proof=<id>` that names another unit. The summary says which rules are
  off.
- `proof`: the proof layer, which reads what the project's test run left. `reports` is required:
  the JUnit XML report, as a glob or a list. `examples` is the folder where tests write examples
  (default `./tmp/skill-proof`). `sources` are globs of the test files with
  `#region skill:<id>` examples. `format` is a command with `{file}`, run on each skill file
  `skillunit proof --write` changes; the check compares the blocks as it leaves them. Globs
  start from the folder of this file and leave out `node_modules`. [Proof](proof.md) has the
  details.

Any other key is an error.

## A library with one skill

SkillUnit's own repository keeps its settings at the root, next to `package-lock.json`, and the
skill folder holds only what an agent reads, which is what someone who installs the skill gets:

```
skillunit.yaml       skill: ./skills/skillunit, specs: ./specs, proof: { reports: ./packages/skillunit/reports/junit.xml }
skillunit.lock       the units the package's tests prove
specs/               the spec files
skills/skillunit/    SKILL.md and the files it links to
packages/skillunit/  the code the units describe, and the tests that prove them
```

From the root, every command runs with no `--config`.

## skillunit.lock

The units the project's tests prove, written by `skillunit proof --write` and committed with the
skill. It sits next to `skillunit.yaml`.

```json
{
  "version": 2,
  "proved": [
    "check-with-is-http-error",
    "retry-defaults"
  ]
}
```

The ids are sorted, one to a line, so a diff shows one unit per line. `--write` adds the units a
test proves and drops ids no unit has, and never drops a unit that is still in the skill;
`skillunit proof --forget <id>` takes a unit off. [Proof](proof.md#the-lock) has the details.

A merge conflict in the lock is resolved by keeping both sides, then running
`skillunit proof --write`, which sorts the ids and puts back a comma missing between the sides.
It also reads a lock with the conflict markers still in it.

## The API key

Each provider has its own key: `TYPESAFE_API_KEY` for `typesafe` and `OPENAI_API_KEY` for
`openai`. Only the key of the provider in use is needed, and `--dry-run` needs none.

The key comes from the environment, or from a `.env` file. SkillUnit reads the
`.env` next to `skillunit.yaml` (the current folder when there is none), then the `.env` of each
folder above it, up to the root of the git repository. A variable already set in the
environment wins over every file, and a closer file wins over a farther one. So one `.env` at the
root of a repository serves every project in it, and CI sets the key as a secret.

The key never goes in `skillunit.yaml` or in a spec: both are committed.

## Decision models

| Provider | Adapter | Models | Key | Limits |
| --- | --- | --- | --- | --- |
| [TypeSafe](https://typesafe.ai) | `typesafe`, the default | `jev-latest`, or any model TypeSafe lists | `TYPESAFE_API_KEY` | 32,000 tokens for the state plus one question, 64,000 for a request |
| [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions) | `openai` | `gpt-6-luna`, the only model the endpoint takes | `OPENAI_API_KEY` | 922,000 tokens, 400 questions and 255 options per question in a request |

The framing of the questions, the automatic `none` option, the thresholds and the token checks
are SkillUnit's, not the adapter's, so every model is asked the same way. A yes/no question has a
framing of its own, since it has no `none` to fall back on: it tells the model to give yes and no
the same probability when the skill does not settle the question. Each adapter sends every spec
as one request.

A choice test is judged on the model's `confidence` when the adapter reports one, and on the top
probability when it does not.

- **`typesafe`** reports Jev's `confidence`, which is almost always within 0.05 of the top
  probability.
- **`openai`** does not report OpenAI's. That field runs well below the top probability when the
  probabilities spread, by up to 0.27, and would fail tests whose answer is right.

`openai` uses the same default thresholds as `typesafe`. With them, both pass every test of
SkillUnit's own specs and tinyfetch's (2026-11-23).

**Pick one model and write your tests for it.** Decision models can answer the same test
differently: OpenAI's, for one, is more decisive than Jev. A spec that fails where it should on
one model may pass on another. Choose a model, run your specs on it, and shape the tests around
how it answers. When you switch models, check the specs again.

When a model refuses a question, which OpenAI's endpoint may do for any question, that test
fails with "the model refused to answer". The other tests of the spec are judged as usual.

## A decision model of your own

`model` can be the path of a module (starting with `./` or `/`) whose default export, or export
named `model`, is a `DecisionModel`, or a function that returns one:

```ts no-check
interface DecisionModel {
  readonly id: string;
  readonly limits: {
    perQuestionTokens: number;
    perRequestTokens: number;
    questionsPerRequest?: number; // every phrasing of a test is one question
    optionsPerQuestion?: number; // the `none` SkillUnit adds included
  };
  decide(request: {
    instructions: string;
    state: Record<string, unknown>;
    questions: { id: string; text: string; instructions?: string; options?: { id: string; description?: string }[] }[];
  }): Promise<{
    answers: Record<string, { probabilities: Record<string, number>; confidence?: number } | { refused: true }>;
    usage: { inputTokens: number; outputTokens: number };
    model: string;
  }>;
}
```

A question without `options` is a yes/no question, answered as `{ yes, no }`. It carries its
own `instructions`, the yes/no framing: send them with that question instead of the request's
`instructions`. A question left
out of `answers` fails its test, and so does one answered `{ refused: true }`, with the reason.
A spec with more questions, or a test with more options, than the optional limits allow is an
error before anything is sent, on a dry run too. `decide` rejects on a failed request, and the spec is reported
as one that could not run.

A skeleton, for a provider with an HTTP API that returns a probability per option:

```js
// A decision model of your own: an object with an id, its token limits, and `decide`.
export default {
  id: 'my-provider',
  limits: { perQuestionTokens: 32_000, perRequestTokens: 64_000 },
  async decide({ instructions, state, questions }) {
    const response = await fetch('https://decisions.example.com/v1/decide', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.MY_PROVIDER_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ instructions, state, questions }),
    });
    if (!response.ok) throw new Error(`my-provider answered ${response.status}`);
    const body = await response.json();
    return {
      // One entry per question id: a probability per option id, or { yes, no } for a yes/no question.
      answers: body.answers,
      usage: { inputTokens: body.usage.input, outputTokens: body.usage.output },
      model: body.model,
    };
  },
};
```

The `choice` threshold is compared with the model's `confidence` when it reports one, and with
the top probability when it does not. The two are not on the same scale, so check the threshold
and the margin against a few runs of your own specs before relying on them.
