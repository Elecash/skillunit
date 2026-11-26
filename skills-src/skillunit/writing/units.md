# SkillUnit — units

How to write one unit: its kind and its labels.

A unit is a level-3 heading, `### <kind>: <id>`, followed by labels. Each label is a paragraph: `Label:` and its text, which may wrap onto the next lines. Blank lines carry no meaning, so a formatter that adds or removes them changes nothing.

| Kind | Labels | Required |
| --- | --- | --- |
| `rule` | When, Do, Even when, Right | When, Do |
| `decision` | When, Decide (one `- **path** — condition` item per path), Even when | When, Decide |
| `fact` | When, Value, Unknown | When, Value |

A unit the project's tests can check is declared in those tests and built into the skill; see [testing/proof.md](../testing/proof.md).

````md
### rule: retry-idempotent-only

When: a request may be retried.

Do: enable `retry` only for GET, HEAD, PUT and DELETE.

Right:

```ts
await tf.get("https://api.example.com/users", { retry: 3 });
```
````

## Rules

{{unit:pick-a-kind}}

{{unit:one-label-per-paragraph}}

{{unit:blank-line-after-a-list}}

{{unit:labels-in-order}}

{{unit:id-names-the-instruction}}
