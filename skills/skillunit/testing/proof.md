# SkillUnit — proving units with the project's tests

How to tie a unit to a test of the code it describes, so the test fails when the unit stops being true.

The project's own tests do the proving; SkillUnit only reads what their run left. A test proves the unit `<id>` when its title contains `[skill:<id>]`. A test can also produce a unit's example: `npx skillunit proof --write` copies it into the block flagged `proof=<id>` after the block's language.

`skillunit.lock`, next to `skillunit.yaml`, lists the ids of the proved units. `npx skillunit proof --write` adds the units the tests prove, and never drops a unit that is still in the skill, so a unit whose test is deleted or skipped fails the check.

| State of a unit | What makes it | What `npx skillunit proof` does |
| --- | --- | --- |
| proved | a tagged test passed, and no tagged test failed | an error when the lock does not list it |
| failed | a tagged test failed; or the lock lists the unit and no tagged test passed | an error |
| unproved | the lock does not list it, and no test is tagged for it | nothing; it is counted |

The settings are under `proof` in `skillunit.yaml`: `reports`, the JUnit XML report of the test run; `sources`, the test files with regions; `examples`, the folder where tests write examples (`./tmp/skill-proof`); `format`, the project's formatter. The tests run first, with a JUnit reporter, then `npx skillunit proof` or `npx skillunit check`.

## Rules

### rule: tag-the-test-that-asserts-it

When: a unit states what the code does: a default, which inputs it takes, what it returns or throws.

Do: put `[skill:<unit id>]` in the title of a test that asserts exactly what the unit states, and write that test when none does; then run the tests and `npx skillunit proof --write`, and commit `skillunit.lock` with the test.

Even when: a test on the same topic already exists; tag it only if it asserts what the unit says, value for value. A unit no test can prove, such as advice, gets no tag and stays unproved.

Right:

```md
it("does not retry by default, and waits 300 ms [skill:retry-defaults]", async () => {
```

Applies: proof, tags

### decision: region-or-file

When: a unit's example should come from a test, so it is code that ran.

Decide: where the test leaves the example.

- **region** — the example is code: put it in the test between a `// #region skill:<id>` line and a `// #endregion` line, add the test file to `proof.sources`, and flag the block `proof=<id>`.

- **file** — the example is a value, such as a JSON definition or a config: write it from the test with `skillExample(id, value)` from `skillunit/proof`, or in another language as `<proof.examples>/<id>.<extension>`, and flag the block `proof=<id>`.

Applies: proof, examples

### rule: write-blocks-from-tests

When: `npx skillunit proof` reports that a block differs from what its test gives.

Do: run the tests, then `npx skillunit proof --write`, and commit the skill with the change.

Even when: the difference is formatting; set `proof.format` to the project's formatter rather than edit the block by hand.

Right:

```sh
npx skillunit proof --write
```

Applies: proof, examples

### rule: fix-the-unit-when-its-test-fails

When: a test tagged for a unit fails after a change to the code.

Do: read the change; when the code is right, correct what the unit says and what the test asserts together, then run the tests and `npx skillunit proof` again.

Even when: the report would pass sooner by skipping the test or removing its tag; the lock lists the unit, so a unit whose tests were all skipped or untagged fails too.

Applies: proof, tests

### rule: forget-only-what-is-no-longer-proved

When: `npx skillunit proof` reports that `skillunit.lock` lists a unit that no test proves.

Do: bring back the test that proved it; run `npx skillunit proof --forget <unit id>` only when the unit is no longer meant to be proved, such as a statement about the code rewritten as advice, and commit `skillunit.lock` with that change.

Even when: `--forget` would make the check pass at once; a proof that is lost by mistake is what the lock is there to catch.

Right:

```sh
npx skillunit proof --forget retry-defaults
```

Applies: proof, lock
