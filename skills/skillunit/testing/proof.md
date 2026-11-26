# SkillUnit — units declared in the project's tests

How to declare a unit in the test that checks it, so the skill is built from the code and changes when the code does.

A unit that a test can check is declared in that test with `unit()` from `skillunit/vitest`, or `createUnit` from `skillunit/unit` for another runner. `source` in `skillunit.yaml` is the folder people write; `skill` is built from it. In the source, `{{unit:<id>}}` alone on a line is where a unit from a test goes, and `{{value:<id>.<name>}}` is a value a test lists in `values`. A unit no test can check, such as advice, is declared with `unit()` and no body: it is built like any unit, and the report reads `declared, no test`. With `skillunit/vitest`, a body that makes no assertion, and calls neither `u.value()` nor `u.example()`, fails its test. A unit heading written in the source is an error.

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

### rule: declare-in-the-test-that-checks-it

When: a unit states what the code does: a default, which inputs it takes, what it returns or throws.

Do: declare the unit with `unit()` around the test that asserts what it states, put `{{unit:<id>}}` in the source where the unit goes, run `npx skillunit proof --write`, and commit the test, the source and the built skill together.

Even when: a test on the same topic already exists; wrap it only if it asserts what the unit says. A unit no test can check, such as advice, is declared with `unit()` and no body.

Right:

````md
```ts
unit("retry-defaults", { when: "a request sets no `retry`.", value: `\`retry\` is ${DEFAULT_RETRY}.` }, async () => {
  expect(calls).toHaveLength(DEFAULT_RETRY + 1);
});
```
````

### rule: build-the-sentence-from-the-code

When: a unit in a test states a value that defines behaviour, such as a default, a limit or how a wait grows.

Do: give the value a name in the code, such as `export const RETRY_TIMES = 2`; use that name in the code and in the assertion of the test, build the sentence from it in a template string, such as `${RETRY_TIMES}x the one before`, and list it in `values`. Type no number into the sentence, and no word that stands for one, such as "doubled", "twice" or "half".

Even when: the code has the value only as a literal, such as `retryDelay * 2 ** n`: give it a name in the code first, then write the unit. `unit()` fails a unit with a body whose text has a number none of its `values` is.

### decision: region-or-example

When: a unit from a test should show an example, so the example is code that ran.

Decide: where the example comes from.

- **region** — the example is code: put it in the body between a `// #region skill:<id>` line and a `// #endregion` line. A path of a decision takes the region `skill:<id>.<path>`.

- **example** — the example is something the body produced, such as an output or a config: pass it to `u.example(lang, text)` in the body.

### rule: edit-the-source-not-the-skill

When: the agent changes the text of a skill that `skillunit.yaml` builds from `source`.

Do: edit the file of the source, or the test that declares the unit, then run `npx skillunit proof --write`; never edit the `skill` folder by hand.

Even when: the fix is one word; the next build would undo it, and `npx skillunit proof` fails until then.

### rule: rebuild-after-the-code-moved

When: `npx skillunit proof` reports that a line of the skill is not what the build gives, after a change to the code.

Do: read the line the build gives; when it says what the code now does, run `npx skillunit proof --write` and commit the built skill with the change.

Even when: the tests pass; a sentence built from the code changes without any test failing, and the difference in the skill is the signal.

Right:

```sh
npx skillunit proof --write
```

### rule: fix-the-unit-when-its-test-fails

When: the test of a unit fails after a change to the code.

Do: read the change; when the code is right, correct the assertions of the test. When its sentence or its assertion has the value as a literal, give the value a name in the code and build both from that name, then run `npx skillunit proof` again.

Even when: skipping the test would make the test run pass; the slot then has no unit, and the proof fails on it.

### rule: keep-the-slot-until-the-unit-goes

When: `npx skillunit proof` reports a `{{unit:<id>}}` that no test left.

Do: bring back the test that declared it; remove the slot only when the unit is no longer meant to be in the skill, or declare the unit with no body when it became advice.

Even when: removing the slot would make the check pass at once; a test that is lost by mistake is what the slot is there to catch.
