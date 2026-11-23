# SkillUnit — units

How to write one unit: its kind, its labels, and the footer the tools read.

A unit is a level-3 heading, `### <kind>: <id>`, followed by labels. Each label is a paragraph: `Label:` and its text, which may wrap onto the next lines. The body (the labels the agent reads) comes first, then the footer (`Applies`, `Check`), which the tools read. Blank lines carry no meaning, so a formatter that adds or removes them changes nothing.

| Kind | Body | Required |
| --- | --- | --- |
| `rule` | When, Do, Even when, Right | When, Do, Applies |
| `decision` | When, Decide (one `- **path** — condition` item per path), Even when | When, Decide, Applies |
| `fact` | When, Value, Unknown | When, Value, Applies |

Every kind takes the footer: `Applies` (the things the unit is about, comma-separated) and `Check` (a regex no example may match). Which units the project's tests prove is in the tests' titles and in `skillunit.lock`, not in the unit; see [testing/proof.md](../testing/proof.md).

````md
### rule: retry-idempotent-only

When: a request may be retried.

Do: enable `retry` only for GET, HEAD, PUT and DELETE.

Right:

```ts
await tf.get("https://api.example.com/users", { retry: 3 });
```

Applies: retries, post

Check: forbid `/\.(post|patch)\([^)]*retry/` in ts
````

Lint runs each `Check` over every fenced block in the languages it names and over every inline code span of the skill.

## Rules

### decision: pick-a-kind

When: the agent turns an instruction of the skill into a unit.

Decide: which kind of unit to write.

- **rule** — a constraint on what the agent writes or does: one `Do`.

- **decision** — the agent chooses between paths that depend on the situation: one `- **path** — condition` item per path under `Decide`.

- **fact** — a value the agent must state exactly, such as a default or a limit: `Value`, and `Unknown` for what the value does not cover.

Even when: a rule seems to need two `Do` lines; that is two rules, or a decision.

Applies: units, kinds

### rule: one-label-per-paragraph

When: the agent writes the labels of a unit.

Do: put each label in a paragraph of its own, with a blank line before and after it.

Right:

```md
When: a request may be retried.

Do: enable `retry` only for GET, HEAD, PUT and DELETE.
```

Applies: units, labels, formatting

Check: forbid `/^When: .*\n(Do|Decide|Value):/m` in md

### rule: blank-line-after-a-list

When: a label follows a list, such as the items of `Right` or the paths of `Decide`.

Do: leave a blank line between the last item and the label.

Applies: units, labels, formatting

### rule: labels-in-order

When: the agent writes or edits a unit.

Do: keep the labels in one order: `When`; `Do`, `Decide` or `Value`; `Unknown`; `Even when`; `Right`; then `Applies`, `Check`.

Applies: units, labels

### rule: id-names-the-instruction

When: the agent names a unit.

Do: use a kebab-case id that names the instruction, unique across the skill, such as `retry-idempotent-only`.

Applies: units, ids

### rule: check-regex-in-a-code-span

When: a rule's mistake can be matched by a regex.

Do: add `Check: forbid` with the regex inside backticks, followed by `in` and the fence languages it applies to.

Right:

```md
Check: forbid `/\.(post|patch)\([^)]*retry/` in ts
```

Applies: units, check

Check: forbid `/Check: forbid \//` in md
