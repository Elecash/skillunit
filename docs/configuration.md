# Configuration

SkillUnit reads `skillunit.yaml` in the folder the command runs in, or the file passed with
`--config`. Every key is optional, command-line options override them, and paths are relative
to the file. Without a file, the skill is the current folder and the specs are in `./specs`.

## Every key

```yaml
skill: ./skill               # folder with SKILL.md (default: the folder of this file)
specs: ./specs               # a spec file, a folder of them, or a list (default: ./specs)
context: "tinyfetch is a small HTTP client for JSON APIs, built on fetch."
model: { provider: typesafe, name: jev-latest }   # or the path of a module: ./my-model.mjs
thresholds:
  choice: 0.5                # lowest confidence that passes a choice test
  yes: 0.7                   # lowest P(yes) that passes an expected "yes"
  no: 0.3                    # highest P(yes) that passes an expected "no"
  margin: 0.13               # how close to a threshold a verdict is marked borderline
sourceRoot: .                # where `Source:` paths start (default: the folder of this file)
examples:
  ts: { tsconfig: ./tsconfig.json }                 # ts, tsx, js and jsx, with the project's tsc
  sh: { command: "sh -n {file}" }                   # any other language: a command with {file}
lint:
  off: [length]              # lint rules not to report
```

- `skill`: the folder with `SKILL.md`. `--skill` overrides it.
- `specs`: where the [specs](writing-specs.md) are. A test command given paths uses those instead.
- `context`: one sentence about what the skill is for. It is sent with every question and helps
  the reader with the vocabulary of the domain.
- `model`: the decision model, as `{ provider: typesafe, name: <model> }` or the path of a
  module (see below). A bare name such as `model: jev-latest` is an error.
- `thresholds`: what a test needs to pass, and `margin`, how close to a threshold a verdict is
  marked borderline. The default margin, 0.13, is the largest move measured across six runs of
  SkillUnit's own specs with no change, among tests whose answer stayed the same.
- `sourceRoot`: the folder `Source:` paths start from. Set it when the code is not next to
  `skillunit.yaml`, as in the layout below.
- `examples`: how lint checks the skill's code examples. `ts` names a tsconfig: every `ts`, `tsx`,
  `js` and `jsx` example is type-checked with the project's own `tsc` (TypeScript 5 or later,
  found in `node_modules` at or above that tsconfig). The tsconfig should resolve the library's
  name to its source, usually with a `paths` entry. Any other language takes a `command` with
  `{file}` where the example's path goes, run in the folder of `skillunit.yaml`; it must exit 0.
  An example that uses names it does not declare fails with "Cannot find name": declare them
  once in a `Setup:` block, which lint puts in front of every example of that language in the
  file. A file with no `Setup` of its own uses the one of its skill's `SKILL.md`. This works in a
  skill that is not written in units too. A block marked `no-check` after its language is not
  checked. The [style guide](style-guide.md#setup) has the details.
- `lint.off`: lint rules whose findings are not reported, by the name each finding carries in
  the JSON report: `parse`, `structure`, `setup`, `check`, `types`, `wrong-code`, `command`,
  `index`, `length`, `source` and `fence`. `length` is the warning about a file above about 300 lines,
  the first to turn off on a skill someone else wrote; `fence` is the warning about a word after
  a fence's language that SkillUnit does not know. The summary says which rules are off.

Any other key is an error.

## A library with one skill

SkillUnit's own repository keeps its settings at the root, next to `package-lock.json`, and the
skill folder holds only what an agent reads, which is what someone who installs the skill gets:

```
skillunit.yaml       skill: ./skills/skillunit, specs: ./specs, sourceRoot: ./packages/skillunit
skillunit.lock
specs/               the spec files
skills/skillunit/    SKILL.md and the files it links to
packages/skillunit/  the code the units describe
```

From the root, every command runs with no `--config`.

## skillunit.lock

`skillunit.lock` sits next to `skillunit.yaml`, or in the skill folder when there is no
config file, and is committed. It has one entry per unit with a `Source`: each `Source` as the
unit writes it, and the fingerprint of that code when the unit was last reviewed.

```json
{
  "version": 1,
  "units": {
    "check-with-is-http-error": { "src/errors.ts#isHttpError": "3683aa817c8469a4" },
    "retry-idempotent-only": { "src/retry.ts": "f303dfe1b57c6c92" }
  }
}
```

Units are sorted by id, one per line, so two branches conflict only when both reviewed the same
unit. It stores no commit, date or author. Only `skillunit review` writes it; nobody edits it by
hand. The name has no `.json` extension, so a formatter leaves it alone.

| State | Meaning | Severity |
| --- | --- | --- |
| in sync | every `Source` fingerprint equals the lock | none |
| stale | a fingerprint differs: the code changed since the last review | error |
| new | the unit, or one of its `Source` values, is not in the lock | error |
| orphan | the lock names a unit or a `Source` that no longer exists | warning |

No lock while some unit has a `Source` is one error, which says to read the units and run
`skillunit review --accept-all`.

A fingerprint is the first 16 hex characters of a SHA-256 of the code:

- A file: in `ts`, `tsx`, `js`, `jsx`, `mts`, `cts`, `mjs` and `cjs`, its tokens without the
  comments, so a comment-only edit or a reformat that keeps the tokens leaves it as it was. In
  any other file, the text with every run of whitespace made one space. Line endings do not
  count.
- `path#name`: only the top-level declarations with that name (a function with its overloads,
  a class, a `const`, `let` or `var`, an interface, a type, an enum, a namespace), so a change
  elsewhere in the file leaves it as it was.
- A folder: the sorted list of its files' paths and fingerprints, without dot folders and
  `node_modules`.

What it does not catch:

- A symbol's fingerprint does not follow the helpers it calls. A unit that depends on two
  declarations lists both: `Source: src/errors.ts#isHttpError, src/errors.ts#HttpError`.
- A formatter that changes tokens (quote style, added semicolons, trailing commas) changes the
  fingerprint, and the units that point at the file come up for review.
- A code file that does not parse falls back to whitespace only, comments included; lint warns
  about it.

The way a fingerprint is computed is fixed by the lock's `version`. A lock with a higher
version than this SkillUnit knows is an error that says to upgrade.

A merge conflict in the lock: take either side, then run `skillunit review`. Any unit whose
fingerprint the other side changed comes up as stale, and accepting it writes the lock again.

## The API key

The decision model's key comes from the environment, or from a `.env` file. SkillUnit reads the
`.env` next to `skillunit.yaml` (the current folder when there is none), then the `.env` of each
folder above it, up to the root of the git repository. A variable already set in the
environment wins over every file, and a closer file wins over a farther one. So one `.env` at the
root of a repository serves every project in it, and CI sets the key as a secret.

The key never goes in `skillunit.yaml` or in a spec: both are committed.

## Decision models

| Provider | Adapter | Models | Key | Limits |
| --- | --- | --- | --- | --- |
| [TypeSafe](https://typesafe.ai) | `typesafe`, the default | `jev-latest`, or any model TypeSafe lists | `TYPESAFE_API_KEY` | 32,000 tokens for the state plus one question, 64,000 for a request |

The framing of the questions, the automatic `none` option, the thresholds and the token checks
are SkillUnit's, not the adapter's, so every model is asked and judged the same way.

## A decision model of your own

`model` can be the path of a module (starting with `./` or `/`) whose default export, or export
named `model`, is a `DecisionModel`, or a function that returns one:

```ts no-check
interface DecisionModel {
  readonly id: string;
  readonly limits: { perQuestionTokens: number; perRequestTokens: number };
  decide(request: {
    instructions: string;
    state: Record<string, unknown>;
    questions: { id: string; text: string; options?: { id: string; description?: string }[] }[];
  }): Promise<{
    answers: Record<string, { probabilities: Record<string, number>; confidence?: number }>;
    usage: { inputTokens: number; outputTokens: number };
    model: string;
  }>;
}
```

A question without `options` is a yes/no question, answered as `{ yes, no }`. A question left
out of `answers` fails its test. `decide` rejects on a failed request, and the spec is reported
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
