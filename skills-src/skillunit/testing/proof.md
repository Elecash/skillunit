# SkillUnit — units declared in the project's tests

How to declare a unit in the test that checks it, so the skill is built from the code and changes when the code does.

A unit that a test can check is declared in that test with `unit()` from `skillunit/vitest`, or `createUnit` from `skillunit/unit` for another runner. `source` in `skillunit.yaml` is the folder people write; `skill` is built from it. In the source, `{{unit:<id>}}` alone on a line is where a unit from a test goes, and `{{value:<id>.<name>}}` is a value a test lists in `values`. A unit no test can check, such as advice, is declared with `unit()` and no body: it is built like any unit, and the report reads `declared, no test`. A unit heading written in the source is an error.

| Spec key | Kind | Becomes |
| --- | --- | --- |
| `when` | every kind | `When:` |
| `do` | rule | `Do:` |
| `value`, or `u.value(text)` in the body | fact | `Value:` |
| `decide`, `paths: [{ path, when }]` | decision | `Decide:` and its paths |
| `unknown`, `evenWhen`, `check` | fact; rule or decision; any kind | `Unknown:`, `Even when:`, `Check:` |
| `values: { name: value }` | any kind | `{{value:<id>.<name>}}` in the source |
| `examples: [{ lang, text }]`, or `u.example(lang, text)` in the body | rule or fact | a block under `Right:` or the `Value:` |
| `ask` | any kind | questions for the decision model about the file that holds the unit |

`npx skillunit proof` runs `proof.run`, builds the skill and compares it with the `skill` folder; `npx skillunit proof --write` writes it. Each finding about a line of the skill names the file that line comes from: the test of a unit, or the source.

## Rules

{{unit:declare-in-the-test-that-checks-it}}

{{unit:build-the-sentence-from-the-code}}

{{unit:region-or-example}}

{{unit:edit-the-source-not-the-skill}}

{{unit:rebuild-after-the-code-moved}}

{{unit:fix-the-unit-when-its-test-fails}}

{{unit:keep-the-slot-until-the-unit-goes}}
