# SkillUnit — code in a unit

How the code an agent copies from a skill comes from the tests.

## Rules

### decision: region-or-example

When: a unit should show an example.

Decide: where the example comes from.

- **region** — the example is code: put it between a `// #region skill:<id>` line and a `// #endregion` line in the test file of the unit. A path of a decision takes the region `skill:<id>.<path>`, and another example of a rule or a fact `skill:<id>.<name>`.

- **example** — the example is something the test produced, such as an output or a settings file: pass it to `u.example(lang, text)` in the body.

Even when: the unit has no body; put its region in a function the test file exports and never calls, so the type-check of the project covers it and nothing runs it.

### rule: complete-examples

When: the agent writes the code of a region.

Do: make it compile on its own: declare in the region every name it uses, or import it in the region `skill:<setup id>` at the top of the test file.

### rule: region-holds-library-code

When: the agent decides what goes inside a region.

Do: put in it only code a user of the library would write; keep the helpers, fixtures and assertions of the test outside it.

Even when: a helper of the test makes the region shorter; the agent copies the region, helper and all, and the helper does not exist in its project.

### rule: type-check-the-tests

When: a project declares units in its tests.

Do: make the type-check of the project, such as `tsc --noEmit`, cover the test files that declare units; Vitest runs a test file without checking its types.

Even when: the tests pass; a region in a function nothing calls passes them with a call the library no longer has.
