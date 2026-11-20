# SkillUnit — units

How to write one unit: its kind, its labels, and the footer the tools read.

A unit is a level-3 heading, `### <kind>: <id>`, followed by labels. Each label is a paragraph: `Label:` and its text, which may wrap onto the next lines. The body (the labels the agent reads) comes first, then the footer (`Applies`, `Check`, `Source`), which the tools read. Blank lines carry no meaning, so a formatter that adds or removes them changes nothing.

| Kind | Body | Required |
| --- | --- | --- |
| `rule` | When, Do, Even when, Right, Wrong | When, Do, Applies |
| `decision` | When, Decide (one `- **path** — condition` item per path), Even when, Wrong | When, Decide, Applies |
| `fact` | When, Value, Unknown | When, Value, Applies |

Every kind takes the footer: `Applies` (the things the unit is about, comma-separated), `Check` (a regex no example may match) and `Source` (the code the unit describes).

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

Applies: retries, post

Check: forbid `/\.(post|patch)\([^)]*retry/` in ts

Source: src/retry.ts
````

Lint runs each `Check` over every fenced block in the languages it names and over every inline code span of the skill, `Wrong` items aside. It also checks that the regex matches the unit's own `Wrong` code, and warns when `Wrong` code compiles and no `Check` matches it. `Source` paths start at the folder of `skillunit.yaml`, or at its `sourceRoot`; sync reports the unit when that file changes and the unit does not.

## Rules

### decision: pick-a-kind

When: the agent turns an instruction of the skill into a unit.

Decide: which kind of unit to write.

- **rule** — a constraint on what the agent writes or does: one `Do`.

- **decision** — the agent chooses between paths that depend on the situation: one `- **path** — condition` item per path under `Decide`.

- **fact** — a value the agent must state exactly, such as a default or a limit: `Value`, and `Unknown` for what the value does not cover.

Even when: a rule seems to need two `Do` lines; that is two rules, or a decision.

Wrong:

- Doing: a `rule` whose `Do` says "use A for small lists and B for large ones".

  Because: two actions in one `Do` read as one instruction, and the condition gets lost.

Applies: units, kinds

Source: src/lint/structure.ts

### rule: one-label-per-paragraph

When: the agent writes the labels of a unit.

Do: put each label in a paragraph of its own, with a blank line before and after it, `Doing` and `Because` included.

Right:

```md
When: a request may be retried.

Do: enable `retry` only for GET, HEAD, PUT and DELETE.
```

Wrong:

- Doing: labels on consecutive lines.

  Because: GitHub shows them as one run of text, and a formatter set to wrap lines joins them, which lint then reports as two labels on one line.

  ```md
  When: a request may be retried.
  Do: enable `retry` only for GET, HEAD, PUT and DELETE.
  ```

Applies: units, labels, formatting

Check: forbid `/^When: .*\n(Do|Decide|Value):/m` in md

Source: src/units/parse.ts

### rule: blank-line-after-a-list

When: a label follows a list, such as the items of `Wrong` or the paths of `Decide`.

Do: leave a blank line between the last item and the label.

Wrong:

- Doing: `Even when:` on the line right after the last path of `Decide`.

  Because: in Markdown that line belongs to the last item, so the reader and lint both lose the label.

Applies: units, labels, formatting

Source: src/units/parse.ts

### rule: labels-in-order

When: the agent writes or edits a unit.

Do: keep the labels in one order: `When`; `Do`, `Decide` or `Value`; `Unknown`; `Even when`; `Right`; `Wrong`; then `Applies`, `Check`, `Source`.

Wrong:

- Doing: `Wrong` before `Right`, or `Applies` before `Do`.

  Because: lint reports a label out of order, and readers expect the instruction before its examples.

Applies: units, labels

Source: src/lint/structure.ts

### rule: id-names-the-instruction

When: the agent names a unit.

Do: use a kebab-case id that names the instruction, unique across the skill, such as `retry-idempotent-only`.

Wrong:

- Doing: `### rule: retries`

  Because: an id that names the topic fits every rule about it, and two units end up with the same id.

Applies: units, ids

Source: src/lint/structure.ts

### rule: check-regex-in-a-code-span

When: a rule's mistake can be matched by a regex.

Do: add `Check: forbid` with the regex inside backticks, followed by `in` and the fence languages it applies to.

Right:

```md
Check: forbid `/\.(post|patch)\([^)]*retry/` in ts
```

Wrong:

- Doing: the regex written bare after `forbid`.

  Because: Markdown reads `*` and `_` in it as emphasis, a formatter rewrites them, and the regex then matches something else without any error.

  ```md
  Check: forbid /post.*retry/ in ts
  ```

- Doing: a `Check` with `require`.

  Because: v1 has only `forbid`; lint reports `require` as not supported.

Applies: units, check

Check: forbid `/Check: forbid \//` in md

Source: src/units/parse.ts#parseCheck

### rule: check-matches-its-wrong-code

When: a unit has both a `Check` and `Wrong` code.

Do: make the regex match every piece of the unit's `Wrong` code that shows the mistake, and nothing in its `Right` examples.

Wrong:

- Doing: a regex that no `Wrong` item of its unit matches.

  Because: it guards nothing; lint reports it as an error so a typo in the regex does not pass unseen.

Applies: units, check

Source: src/lint/check.ts

### rule: wrong-as-code

When: the agent writes a `Wrong` item for a mistake that can be shown as code.

Do: write `Doing` as one code span and nothing else, or describe the mistake in `Doing` and put the code in a fenced block inside the item.

Right:

```md
- Doing: `tf.post("https://api.example.com/orders", { item: 42 }, { retry: 3 })`

  Because: a retried POST can create the same order twice.
```

Wrong:

- Doing: "passing `retry` to `tf.post`" as prose with code spans in it.

  Because: lint checks only code it can isolate; prose around the code leaves the mistake unchecked.

Applies: units, wrong

Source: src/lint/lint.ts

### rule: source-from-the-config-folder

When: the agent writes the `Source` of a unit.

Do: write the path of the file the unit describes relative to the folder of `skillunit.yaml`, or to its `sourceRoot`, optionally with `#symbol`.

Right:

```md
Source: src/client.ts#create
```

Wrong:

- Doing: an absolute path, or a path from the root of the repository when `skillunit.yaml` sits in a subfolder.

  Because: lint reports a `Source` that does not exist or is absolute, and sync then has nothing to compare.

Applies: units, source

Check: forbid `/^Source: \//m` in md

Source: src/lint/sources.ts
