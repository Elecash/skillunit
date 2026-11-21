# Style guide

How to write a skill that people can read, agents can follow and SkillUnit can test.

## Files

- **Small files, one topic each.** SKILL.md is the entry point: what the library is, the
  decisions every task meets, and a "Where to look" table that names the file for each task.
  Every other topic gets its own file, named after it (see "The index").
- **Split when a file covers more than one task.** If an agent doing one task only needs half
  the file, it is two files. Above roughly 300 lines, look for the split.
- **Do not split below one task.** An agent should not need five lookups to write one form.
  The "Where to look" table must make the right file obvious.

Why small files: an agent loads only what the task needs, SkillUnit can send the whole file
with its tests within the decision model's limit, and when a file changes only its tests run.

## The index

A skill is a tree an agent walks by task, not a document it reads whole:

```
skill/
  SKILL.md               what the library is, the decisions every task meets, the index
  widgets/calendar.md    one file per thing
  features/i18n.md       one file per feature
  hosts/react.md
```

To translate a calendar, the agent reads `widgets/calendar.md`, then `features/i18n.md`.

- `SKILL.md` has an index table, from a task or a thing to its file. Every file is reachable
  from it; lint reports a file no link leads to.
- A rule about one thing lives in that thing's file. A rule that crosses two (how i18n applies
  to the calendar) lives in the more specific file, and the other links to it.
- Lint warns about a file above about 300 lines.

## Layout of a file

```
# <Library> — <topic>

One to three lines: what this file covers.

Setup:
<a fence with the imports every example in this file assumes>

## <Reference section>
Explanations, signatures, option tables, URLs and examples.

## <Another reference section>
...

## Rules
Every unit of this file, and nothing else.
```

**Prose explains, rules decide.** The reference sections may describe how things work, but
every instruction the agent must follow is a unit in `## Rules`. Concretely:

1. Prose never states an instruction that is not also a unit.
2. Prose never qualifies a rule ("except when…"). An exception goes inside its unit, under
   `Even when`. A rule written far from its exception is the one agents get wrong.
3. Prose refers to a rule by id: "see `fetch-before-css`".
4. A rule refers to prose by section name, never by position: "from 'Three layers'", not
   "below".

## Units

A unit has two parts: the body, which the agent reads, and the footer, which the tools read.
The label decides the part: `Applies`, `Check` and `Source` are footer, every other label is
body.

Every label is its own paragraph, with a blank line before and after it, `Doing` and `Because`
included. GitHub then shows one label per line, and a formatter leaves the unit as it is.

````
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

- Doing: retrying a POST by hand in an interceptor.

  Because: same duplicate, and the retry is invisible in the call.

Applies: retries, post

Check: forbid `/\.(post|patch)\([^)]*retry/` in ts

Source: src/retry.ts
````

Three kinds. Labels always in this order; omit the optional ones you do not need.

| Kind | Body | Footer | Use it for |
|---|---|---|---|
| `rule` | When, Do, Even when, Right, Wrong | Applies, Check, Source | a constraint on what the agent writes |
| `decision` | When, Decide (+ one `- **path** — condition` per path), Even when, Wrong | Applies, Check, Source | choosing between paths |
| `fact` | When, Value, Unknown | Applies, Check, Source | a value the agent must state exactly |

Required: `When` and `Applies`, plus `Do` (rule), `Decide` (decision) or `Value` (fact).

**Structure is flat.** A label and its text are one paragraph; a long line may wrap. Only `Right`, `Wrong` and the paths of `Decide`
may be lists, and lists go one level deep, never more. If a rule needs two `Do`, it is two
rules, or a `decision`.

### Writing each label

Body:

- **When**: the situation as the agent meets it, not the topic. "Writing CSS for a form", not
  "Styling".
- **Do**: one action, with the exact API names.
- **Even when**: the situations where the rule still holds although it looks like it should
  not (autonomous runs, "one option seems obvious").
- **Right**: the smallest example that does it correctly, or a list of them. Each must pass
  every `Check` and type-check with the file's `Setup`.
- **Wrong**: the mistakes an agent is likely to make, one list item each:
  `- Doing:` the mistake, ideally as code, and below it, as a second paragraph of the same
  item, `Because:` what breaks ("renders blank with no
  error", not "it is better"). This is the only place where an anti-pattern may appear. Each
  item becomes a wrong option in the generated tests, so more realistic mistakes mean
  stricter tests. When the mistake can be shown as code, write `Doing` as code and nothing
  else: the linter type-checks it, and warns when the wrong code compiles and no `Check` of the
  unit matches it, because then nothing guards the rule.
- **Value / Unknown** (fact): the value, and what to say about cases it does not cover, so the
  agent does not invent.

Footer:

- **Applies**: names from the skill's inventory (widgets, groups, hosts, APIs, contexts,
  features), comma-separated. Name the specific things; a group like `inputs` hides gaps.
  Drives the coverage report and test selection.
- **Check**: `` forbid `/regex/` in <langs> ``, when the wrong pattern can be matched. The
  regex is written in a code span. The linter runs it over every fenced block in those
  languages and over every inline code span of the skill, except `Wrong` items. It must match
  the unit's own `Wrong` code, or the linter reports it as a regex that guards nothing. The
  flags `g` and `y` are not allowed. Any kind of unit may have a `Check`.
- **Source**: the code the unit describes, `path` or `path#symbol`, relative to the folder of
  `skillunit.yaml` or to its `sourceRoot`. When that code changes, comments and formatting
  aside, `skillunit sync` reports the unit until someone reads the change and accepts the unit
  in `skillunit review`, and `skillunit test --changed` runs the tests that name it. With
  `#symbol`, only that declaration counts; list every declaration the unit relies on.

### Naming

- Ids are kebab-case, unique across the skill, and name the instruction, not the topic:
  `retry-idempotent-only`, not `retries`.

## Formatters

A skill file has to read well on GitHub and survive a Markdown formatter. One label per
paragraph does most of the work:

- In Markdown, consecutive lines are one paragraph. Labels written on consecutive lines show
  on GitHub as a single run: "When: … Do: … Right:".
- A label written right under a list item belongs to that item. Prettier indents it and a
  renderer shows it inside the item.
- Prettier leaves a unit written one label per paragraph unchanged with `proseWrap` set to
  `preserve` or `never`. With `always` it only wraps long lines, and a label's text runs to
  the end of its paragraph.

The linter still reads labels on consecutive lines and warns about them. That form is only
safe with `proseWrap: preserve`.

Two more habits:

- **The regex of a `Check` goes in a code span.** Outside one, Markdown reads `*` and `_` as
  emphasis, a formatter rewrites them, and the regex then matches something else.
- **Code in fences may be rewritten**: Prettier turns `'` into `"`. Write `Check` regexes that
  accept both quotes (`['"]`), or set `embeddedLanguageFormatting: off` for the skill folder.

## Examples

- Every code example in the skill follows every unit. The linter enforces it with `Check`.
- Agents copy examples before they read rules. An example that breaks a rule wins over the rule.
- Keep anti-patterns out of examples. They belong in `Wrong`.
- Every example type-checks against the current API, on its own or with the file's `Setup`.
  A name that is not defined is a lint error, not a snippet the linter forgives.
- A block that shows a signature or a shape, not code to copy, does not type-check. Put
  signatures in a table or in inline code, or mark the fence `no-check`.

### Setup

The imports and declarations every example of a file assumes are written once:

````
Setup:

```ts
import { tf } from "tinyfetch";
```
````

- `Setup` goes after the intro lines and before the first example, never inside `## Rules`.
- One `Setup` per file and language. The agent reads it once and knows where each name comes
  from. The linter puts it in front of every example of that language before type-checking.
- An example that needs more (another import, a declared value) carries it inside its own
  block. It does not import again what `Setup` already imports.
- A fragment that cannot type-check on purpose gets `no-check` after the language on its
  fence (`ts no-check`). Use it rarely: an unchecked example is one that can go stale.

### Short examples

Docs leave things out of their examples, and an example in a skill still has to type-check.
Three ways to keep it short and complete:

- Put what every example of the file assumes in `Setup`, stand-in values included, declared
  without a body: `declare const user: User;` or `declare function render(user: User): void;`.
  The example then uses `user` as if the code around it had made one.
- Leave a part out with a comment, such as `// handle the other cases` inside a `catch`. A
  comment parses; three dots do not, and lint reports the block.
- Show only the call the rule is about, not the function around it.

`no-check` stays the last resort, for a fragment none of these can make compile.

## Example file

A complete file, from [tinyfetch](https://github.com/Elecash/skillunit/blob/main/apps/tinyfetch/skill/features/retries.md):

````md
# tinyfetch — retries

tinyfetch can repeat a request that failed with a network error or a 5xx status. It never retries a 4xx status or a timeout.

Setup:

```ts
import { tf } from "tinyfetch";
```

## Options

| Option       | Type        | Default | Meaning                                              |
| ------------ | ----------- | ------- | ---------------------------------------------------- |
| `retry`      | number      | 0       | extra attempts after the first one                   |
| `retryDelay` | number (ms) | 300     | wait before the first new attempt, doubled each time |

```ts
await tf.get("https://api.example.com/users", { retry: 3, retryDelay: 500 });
```

## Rules

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
