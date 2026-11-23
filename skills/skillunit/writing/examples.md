# SkillUnit — code examples

How to write the code in a skill so lint can check it against the current API.

Agents copy examples before they read rules, so an example that breaks a rule or no longer compiles teaches the mistake. Lint type-checks every `ts`, `tsx`, `js` and `jsx` block with the project's own `tsc`, after the file's `Setup` block of the same language. A `tsx` block uses the `tsx` Setup, or the `ts` one when the file has none. A file with no `Setup` of its own for a language uses the one of the nearest `SKILL.md` above it that has one, up to the skill folder. Blocks in other languages run through a command, when `skillunit.yaml` sets one.

```yaml
examples:
  ts: { tsconfig: ./tsconfig.json }
  py: { command: "python3 -m py_compile {file}" }
```

The tsconfig named in `examples.ts` resolves the library's own name, usually with a `paths` entry, so an example's import reaches the current source. Without `examples.ts`, lint skips those blocks and says how many it skipped. Types that only generated code has, such as a Prisma client or a TanStack Router route tree, come from the tsconfig too: it includes the generated code, or a small fixture checked in for it, and the `Setup` imports it; a `Setup` cannot write them.

## Rules

### rule: setup-once-per-file

When: the examples of a file need imports or declarations.

Do: write them once, as `Setup:` followed by a fenced block, after the file's introduction, before its first example and outside `## Rules`; when most files of the skill need the same ones, write that `Setup` once in `SKILL.md`, which covers every file with no `Setup` of its own. A file that has its own `Setup` uses only that one, so its `Setup` imports again what the file needs from `SKILL.md`'s.

Right:

````md
Setup:

```ts
import { tf } from "tinyfetch";
```
````

Applies: examples, setup

### rule: setup-per-version

When: a file shows code of another library or of an older version under a name the `Setup` it uses declares, such as the "before" blocks of a migration guide.

Do: give that file a `Setup` of its own that declares the names its examples need, or mark the "before" blocks `no-check`.

Applies: examples, setup

### rule: complete-examples

When: the agent writes an example.

Do: make it compile on its own after the file's `Setup`: declare every name it uses, in the block or in `Setup`.

Applies: examples

### rule: short-complete-examples

When: an example would need more code than the point it makes.

Do: declare what every example assumes in `Setup`, stand-in values included, without a body (`declare const user: User;`); leave a part out with a comment such as `// handle the other cases`; show only the call the rule is about.

Right:

````md
Setup:

```ts
import { tf } from "tinyfetch";

interface Order { id: number; item: number }
declare const draft: { item: number };
```

```ts
const order = await tf.post<Order>("https://api.example.com/orders", draft);
```
````

Applies: examples, setup

### rule: signatures-in-tables

When: the agent shows a signature or the shape of an object rather than code to copy.

Do: put it in a table or in inline code, or mark its fence `no-check` after the language.

Right:

```md
| Call | Resolves to |
| --- | --- |
| `tf.get(path, options)` | the parsed body |
```

Applies: examples

### rule: language-on-every-example

When: the agent writes a fenced block under `Right` or a path of `Decide`.

Do: name its language after the opening fence, such as `ts`, `sh` or `yaml`.

Applies: examples

### rule: no-check-rarely

When: a block cannot compile on purpose, such as a fragment that shows one line of a larger file.

Do: mark it `no-check` after the language (`ts no-check`), and only that block.

Even when: many blocks fail after a change to the library; fix them, since that failure is what lint is for.

Applies: examples
