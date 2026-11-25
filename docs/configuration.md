# Configuration

SkillUnit reads `skillunit.yaml` in the folder the command runs in, or the file passed with
`--config`. Every key is optional, command-line options override them, and paths are relative
to the file. Without a file, the skill is the current folder.

## Every key

```yaml
skill: ./skill               # folder with SKILL.md (default: the folder of this file)
source: ./skill-src          # the folder people write; skill is built from it (no proof without it)
context: "tinyfetch is a small HTTP client for JSON APIs, built on fetch."
model: { provider: typesafe, name: jev-latest }   # or provider: openai, or a module: ./my-model.mjs
thresholds:
  choice: 0.5                # lowest probability of the expected option that passes a choice test
  yes: 0.7                   # lowest P(yes) that passes an expected "yes": 0.5 or more
  no: 0.3                    # highest P(yes) that passes an expected "no": under 0.5
  margin: 0.13               # how close to a threshold a verdict is marked borderline
examples:
  ts: { tsconfig: ./tsconfig.json }                 # ts, tsx, js and jsx, with the project's tsc
  sh: { command: "sh -n {file}" }                   # any other language: a command with {file}
lint:
  off: [length]              # lint rules not to report
proof:
  run: "npx vitest run skill.test"           # the tests that declare units, run through the shell
  units: ./tmp/skill-units                   # where the tests leave their units (the default)
  sources: ["src/**/*.test.ts"]              # test files with `#region skill:<id>` examples
  format: "npx --no-install prettier --write {file}"   # run on each built Markdown file
```

- `skill`: the folder with `SKILL.md`. `--skill` overrides it. With `source`, it is built.
- `source`: the folder people write, with `{{unit:<id>}}` where a unit goes and
  `{{value:<id>.<name>}}` where a value of one does. `skillunit proof --write` builds `skill` from
  it and the units the tests declare. The two folders cannot sit one inside the other. Without
  `source` there is no proof layer and no [questions](questions.md) for the decision model.
  [Proof](proof.md#the-source-and-its-slots) has the details.
- `context`: one sentence about what the skill is for. It is sent with every question and helps
  the reader with the vocabulary of the domain.
- `model`: the decision model, as `{ provider: typesafe | openai, name: <model> }` or the path of
  a module (see below). Without `name`, the provider's default model. A bare name such as
  `model: jev-latest` is an error. `--provider` and `--model` override it.
- `thresholds`: what a test needs to pass, and `margin`, how close to a threshold a verdict is
  marked borderline. `yes` is 0.5 or more and `no` is under 0.5, so a yes/no question passes only
  when the model leans to the answer it expects, and no answer passes both a question that
  expects yes and one that expects no; SkillUnit refuses other values. The default margin, 0.13,
  covers the largest move measured: across five runs of SkillUnit's own questions and
  tinyfetch's on `typesafe` with no change, a question whose answer stayed the same moved by 0.12
  at most.
  `openai` gives the same numbers for the same request every run, so there a borderline verdict
  is one that a small change to the wording or to the order of the options may flip.
- `examples`: how lint checks the skill's code examples. `ts` names a tsconfig: every `ts`, `tsx`,
  `js` and `jsx` example is type-checked with the project's own `tsc` (TypeScript 5 or later,
  found in `node_modules` at or above that tsconfig). The tsconfig should resolve the library's
  name to its source, usually with a `paths` entry. Any other language takes a `command` with
  `{file}` where the example's path goes, run in the folder of `skillunit.yaml`; it must exit 0.
  A key and a fence name a language the same way, and the usual pairs are one language: `py` and
  `python`, `js` and `javascript`, `ts` and `typescript`, `sh`, `bash` and `shell`, `yml` and
  `yaml`. Lint warns about a language set here that no block of the skill is in.
  An example that uses names it does not declare fails with "Cannot find name": declare them
  once in a `Setup:` block, which lint puts in front of every example of that language in the
  file. A file with no `Setup` of its own for a language uses the one of the nearest `SKILL.md`
  above it that has one, so a `Setup` in the root `SKILL.md` covers the skills nested in it too.
  This works in a skill that is not written in units too. A block marked `no-check` after its language is not
  checked. The [style guide](style-guide.md#setup) has the details.
- `lint.off`: lint rules whose findings are not reported, by the name each finding carries in
  the JSON report: `parse`, `structure`, `setup`, `check`, `types`, `command`,
  `index`, `length` and `fence`. `length` is the warning about a file above about 300 lines,
  the first to turn off on a skill someone else wrote; `fence` is the warning about a word after
  a fence's language that SkillUnit does not know. The summary says which rules are off.
- `proof`: how `skillunit proof` builds the skill, with `source`. `run` is the command that runs
  the tests that declare units, from the folder of this file; `proof`, `check` and `test` run it,
  and without it the units already in `units` are used. Point it at those files only, such as
  `npx vitest run skill.test` for files named `*.skill.test.ts`: on SkillUnit's own skill that is
  4.0 s where the whole suite takes 70.9 s, and CI still runs the whole suite. `units` is the
  folder where the tests leave their units (default `./tmp/skill-units`), and `proof` empties it
  of its records before `run`. `sources` are globs of the test files with `#region skill:<id>`
  examples. `format` is a command with `{file}`, run on each built Markdown file. Globs start
  from the folder of this file and leave out `node_modules`.
  [Proof](proof.md#which-tests-proofrun-runs) has the details.

Any other key is an error.

## A library with one skill

SkillUnit's own repository keeps its settings at the root, next to `package-lock.json`, and the
skill folder holds only what an agent reads, which is what someone who installs the skill gets:

```
skillunit.yaml       skill: ./skills/skillunit, source: ./skills-src/skillunit, proof: { run: … }
skills-src/skillunit/  the skill as people write it: prose, tables, and a slot for each unit
skills/skillunit/    SKILL.md and the files it links to, built from the source and the tests
packages/skillunit/  the code the units describe; its `*.skill.test.ts` files declare the units
                     and the questions
```

From the root, every command runs with no `--config`.

## The API key

Each provider has its own key: `TYPESAFE_API_KEY` for `typesafe` and `OPENAI_API_KEY` for
`openai`. Only the key of the provider in use is needed, and `--dry-run` needs none.

The key comes from the environment, or from a `.env` file. SkillUnit reads the
`.env` next to `skillunit.yaml` (the current folder when there is none), then the `.env` of each
folder above it, up to the root of the git repository. A variable already set in the
environment wins over every file, and a closer file wins over a farther one. So one `.env` at the
root of a repository serves every project in it, and CI sets the key as a secret.

The key never goes in `skillunit.yaml` or in a test: both are committed.

## Decision models

| Provider | Adapter | Models | Key | Limits |
| --- | --- | --- | --- | --- |
| [TypeSafe](https://typesafe.ai) | `typesafe`, the default | `jev-latest`, or any model TypeSafe lists | `TYPESAFE_API_KEY` | 32,000 tokens for the state plus one question, 64,000 for a request |
| [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions) | `openai` | `gpt-6-luna`, the only model the endpoint takes | `OPENAI_API_KEY` | 922,000 tokens, 400 questions and 255 options per question in a request |

The framing of the questions, the automatic `none` option, the thresholds and the token checks
are SkillUnit's, not the adapter's, so every model is asked the same way. A yes/no question has a
framing of its own, since it has no `none` to fall back on: it tells the model to give yes and no
the same probability when the skill does not settle the question. Each adapter sends the
questions about one file, with the same `section` and `with`, as one request.

A choice question is judged on the probability of the option the model ranks first, whatever else
the model reports about its answer.

`openai` uses the same default thresholds as `typesafe`. With them, on 2026-11-25, `typesafe`
passed all 58 questions of SkillUnit's own skill and all 16 of tinyfetch's; `openai` passed the
16 of tinyfetch and 55 of the 58, three right answers under the threshold.

**Pick one model and write your questions for it.** Decision models can answer the same question
differently: OpenAI's, for one, is more decisive than Jev. A question that fails where it should
on one model may pass on another. Choose a model, run your questions on it, and shape them around
how it answers. When you switch models, check the questions again.

When a model refuses a question, which OpenAI's endpoint may do for any question, that question
fails with "the model refused to answer". The other questions of the request are judged as usual.

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
    answers: Record<string, { probabilities: Record<string, number> } | { refused: true }>;
    usage: { inputTokens: number; outputTokens: number };
    model: string;
  }>;
}
```

A question without `options` is a yes/no question, answered as `{ yes, no }`. It carries its
own `instructions`, the yes/no framing: send them with that question instead of the request's
`instructions`. A question left
out of `answers` fails, and so does one answered `{ refused: true }`, with the reason. When a file
has more questions than `questionsPerRequest`, SkillUnit splits them into several requests. A
question with more phrasings than that, or with more options than `optionsPerQuestion`, is an
error before anything is sent, on a dry run too. `decide` rejects on a failed request, and the
request is reported as one that could not run, with the questions it held.

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

The thresholds are compared with these probabilities, so the probabilities of a question's
options should add up to 1. Check the thresholds and the margin against a few runs of your own
questions before relying on them.
