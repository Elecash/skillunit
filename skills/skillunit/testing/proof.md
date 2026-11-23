# SkillUnit — proving units with the project's tests

How to tie a unit to a test of the code it describes, so the test fails when the unit stops being true.

The project's own tests do the proving; SkillUnit only reads what their run left. A test proves the unit `<id>` when its title contains `[skill:<id>]`. A test can also produce a unit's example: `npx skillunit proof --write` copies it into the block flagged `proof=<id>` after the block's language.

| State of a unit | What makes it | What `npx skillunit proof` does |
| --- | --- | --- |
| proved | a tagged test passed, and no tagged test failed | nothing |
| `Proof: none` | the footer label `Proof: none, <reason>` | nothing |
| pending | neither | an error with `proof.require` on, the default; a count with it off |

The settings are under `proof` in `skillunit.yaml`: `reports`, the JUnit XML report of the test run; `sources`, the test files with regions; `examples`, the folder where tests write examples (`./tmp/skill-proof`); `format`, the project's formatter; `require`. The tests run first, with a JUnit reporter, then `npx skillunit proof` or `npx skillunit check`.

## Rules

### rule: tag-the-test-that-asserts-it

When: a unit states what the code does: a default, which inputs it takes, what it returns or throws.

Do: put `[skill:<unit id>]` in the title of a test that asserts exactly what the unit states, and write that test when none does.

Even when: a test on the same topic already exists; tag it only if it asserts what the unit says, value for value.

Right:

```md
it("does not retry by default, and waits 300 ms [skill:retry-defaults]", async () => {
```

Applies: proof, tags

Proof: none, advice on writing tests

### decision: region-or-file

When: a unit's example should come from a test, so it is code that ran.

Decide: where the test leaves the example.

- **region** — the example is code: put it in the test between a `// #region skill:<id>` line and a `// #endregion` line, add the test file to `proof.sources`, and flag the block `proof=<id>`.

- **file** — the example is a value, such as a JSON definition or a config: write it from the test with `skillExample(id, value)` from `skillunit/proof`, or in another language as `<proof.examples>/<id>.<extension>`, and flag the block `proof=<id>`.

Applies: proof, examples

Proof: none, advice on writing tests

### rule: write-blocks-from-tests

When: `npx skillunit proof` reports that a block differs from what its test gives.

Do: run the tests, then `npx skillunit proof --write`, and commit the skill with the change.

Even when: the difference is formatting; set `proof.format` to the project's formatter rather than edit the block by hand.

Right:

```sh
npx skillunit proof --write
```

Applies: proof, examples

Proof: none, advice on acting on a report

### rule: proof-none-when-no-test-can

When: a unit is advice to the agent, or a claim about something the project's tests cannot see, such as what a server does with a repeated request.

Do: end the unit with `Proof: none,` and the reason.

Even when: a test is close to the topic; tagging a test that does not assert what the unit says hides a unit that nothing proves.

Right:

```md
Proof: none, advice on which timeout to choose
```

Applies: proof, units

Proof: none, advice on writing units

### rule: fix-the-unit-when-its-test-fails

When: a test tagged for a unit fails after a change to the code.

Do: read the change; when the code is right, correct what the unit says and what the test asserts together, then run the tests and `npx skillunit proof` again.

Even when: the report would pass sooner by skipping the test or removing its tag; with `proof.require` on, a unit whose tests were all skipped or untagged fails too, and with it off the unit is left unproved.

Applies: proof, tests

Proof: none, advice on acting on a report
