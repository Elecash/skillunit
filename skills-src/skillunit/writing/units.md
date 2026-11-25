# SkillUnit — units

How to write one unit: its kind and its labels.

A unit is a level-3 heading, `### <kind>: <id>`, followed by labels. Each label is a paragraph: `Label:` and its text, which may wrap onto the next lines. Blank lines carry no meaning, so a formatter that adds or removes them changes nothing.

| Kind | Labels | Required |
| --- | --- | --- |
| `rule` | When, Do, Even when, Right | When, Do |
| `decision` | When, Decide (one `- **path** — condition` item per path), Even when | When, Decide |
| `fact` | When, Value, Unknown | When, Value |

Every kind may end with `Check`, a regex no example may match, which lint reads and the agent does not. A unit the project's tests can check is declared in those tests and built into the skill; see [testing/proof.md](../testing/proof.md).

````md
### rule: retry-idempotent-only

When: a request may be retried.

Do: enable `retry` only for GET, HEAD, PUT and DELETE.

Right:

```ts
await tf.get("https://api.example.com/users", { retry: 3 });
```

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

{{unit:one-label-per-paragraph}}

{{unit:blank-line-after-a-list}}

{{unit:labels-in-order}}

{{unit:id-names-the-instruction}}

{{unit:check-regex-in-a-code-span}}
