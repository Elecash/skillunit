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
  from it; lint reports a file that no link or path leads to. A relative path to the file counts
  as well as a link: in a code span, in plain text, or in a fence with no language or `text`,
  such as a list of files, one per line. A path in a fence of a language is code, and does not
  count. A bare file name, `strings.md`, counts when no other file of the skill has that name;
  when two do, write the path. A folder with its own `SKILL.md` is a skill of its own, reached
  from that `SKILL.md`.
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

A unit is a heading and labels. The agent reads every label but `Check`, which only lint reads
and which comes last.

Every label is its own paragraph, with a blank line before and after it. GitHub then shows one
label per line, and a formatter leaves the unit as it is.

````
### rule: retry-idempotent-only

When: a request may be retried.

Do: enable `retry` only for GET, HEAD, PUT and DELETE.

Right:

```ts
await tf.get("https://api.example.com/users", { retry: 3 });
```

Check: forbid `/\.(post|patch)\([^)]*retry/` in ts
````

Three kinds. Labels always in this order; omit the optional ones you do not need.

| Kind | Labels | Use it for |
|---|---|---|
| `rule` | When, Do, Even when, Right, Check | a constraint on what the agent writes |
| `decision` | When, Decide (+ one `- **path** — condition` per path), Even when, Check | choosing between paths |
| `fact` | When, Value, Unknown, Check | a value the agent must state exactly |

Required: `When`, plus `Do` (rule), `Decide` (decision) or `Value` (fact).

A unit is its instruction and one example. The other labels are there for the case that needs
them, not to fill in.

**Structure is flat.** A label and its text are one paragraph; a long line may wrap. Only `Right` and the paths of `Decide`
may be lists, and lists go one level deep, never more. If a rule needs two `Do`, it is two
rules, or a `decision`.

### Writing each label

- **When**: the situation as the agent meets it, not the topic. "Writing CSS for a form", not
  "Styling".
- **Do**: one action, with the exact API names.
- **Even when**: the situations where the rule still holds although it looks like it should
  not (autonomous runs, "one option seems obvious").
- **Right**: the smallest example that does it correctly, or a list of them. Each must pass
  every `Check` and type-check with the file's `Setup`.
- **Value / Unknown** (fact): the value, and what to say about cases it does not cover, so the
  agent does not invent.
- **Check**: `` forbid `/regex/` in <langs> ``, when the wrong pattern can be matched. The
  regex is written in a code span. The linter runs it over every fenced block in those
  languages and over every inline code span of the skill. The flags `g` and `y` are not
  allowed. Any kind of unit may have a `Check`.

A unit says nothing about whether a test proves it. A test that proves it carries `[skill:<id>]`
in its title, and `skillunit.lock` lists the proved units; see [Proof](proof.md).

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
- Keep anti-patterns out of the skill. An agent copies the code it sees.
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
- A file with no `Setup` of its own for a language uses the one of the nearest `SKILL.md`
  above it that has one for that language, up to the skill folder. A nested skill, a folder
  with a `SKILL.md` of its own, so uses the root's `Setup` until it writes its own. Write the
  imports most files need once, in the root `SKILL.md`. A file or a `SKILL.md` with its own
  `Setup` uses only that one, so it repeats what it needs from the one above. This works in a
  skill that is not written in units too.
- An example that needs more (another import, a declared value) carries it inside its own
  block. A complete example, one meant to be copied whole, may import and create again what
  `Setup` declares: a name an example declares at its top level is taken from the example, and
  lint leaves the `Setup`'s declaration of that name out for that example. So a skill in prose
  can have `import { Resend } from 'resend'` and `declare const resend: Resend` in `Setup`
  for its fragments, next to examples that import `Resend` and create `resend` themselves.
- A fragment that cannot type-check on purpose gets `no-check` after the language on its
  fence (`ts no-check`). Use it rarely: an unchecked example is one that can go stale. Lint
  warns about any other bare word there, so a typo such as `nocheck` does not leave the block
  checked by surprise; `key=value` and `{...}`, which other tools read, are left alone.
- JSX goes in a `tsx` or `jsx` fence. In a `ts` fence it does not parse, and lint says so.
- A `declare module` or `declare global` in an example is checked apart from the other
  examples, so it changes no type outside its own block.

#### When a `Setup` is not enough

- **Code of another library under the same name.** A migration guide shows the old client as
  `redis` too, and the `Setup` of `SKILL.md` types `redis` as the new one, so lint checks the
  old code against the new types and reports findings that are not mistakes (nine in
  Upstash's two migration files). Give that file a `Setup` of its own, which then is the one
  its examples use, or mark the "before" blocks `no-check`.
- **Types that come from generated code.** `createFileRoute('/posts')` in TanStack Router and
  `prisma.user` in Prisma type-check only against code a generator writes, and a `Setup`
  cannot supply it. In a project that has the generated code, point `examples.ts.tsconfig` at
  a tsconfig that includes it, and import it in the `Setup`. A library's own skill repository
  has no generated code: check in a small fixture that the tsconfig includes, or mark those
  blocks `no-check`.

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

tinyfetch can repeat a request that failed. Which failures it repeats, and how long it waits, are in the rules below.

Setup:

```ts
import { tf } from "tinyfetch";
```

## Options

| Option       | Type        | Meaning                                              |
| ------------ | ----------- | ---------------------------------------------------- |
| `retry`      | number      | extra attempts after the first one                   |
| `retryDelay` | number (ms) | wait before the first new attempt, doubled each time |

```ts
await tf.get("https://api.example.com/users", { retry: 3, retryDelay: 500 });
```

## Rules

### fact: retry-defaults

When: a request sets no `retry`, or no `retryDelay`.

Value: `retry` is 0, so a failed request is not repeated; `retryDelay` is 300 ms before the first new attempt, doubled before each next one.

### fact: what-is-retried

When: a request with `retry` fails.

Value: a network error and a 5xx status are retried; a 4xx status and a timeout never are.

### rule: retry-idempotent-only

When: a request may be retried.

Do: enable `retry` only for GET, HEAD, PUT and DELETE.

Right:

```ts
await tf.get("https://api.example.com/users", { retry: 3 });
```

Check: forbid `/\.(post|patch)\([^)]*retry/` in ts
````
