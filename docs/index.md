# SkillUnit docs

- [Writing the tests of a skill](style-guide.md): the list from the code, a unit and its body, the change that proves it, a unit with no body and its reason, when a unit gets a question, and the copy check.
- [Questions](questions.md): when to ask, where the questions for the decision model go, their fields, `with`, how to write one that fails when its rule is gone, and the copy check that shows it does.
- [The kinds of unit](units.md): a fact, a rule and a decision, each with what it is for, its keys, a test that declares one and the Markdown it becomes.
- [Proof](proof.md): the files of the skill declared with `setup()`, units declared in the project's tests with `unit()`, those no test proves, names from the code with `key()` and `exportNames()`, which tests `proof.run` runs, the JSON a test in another language writes, and what proof does not do.
- [Configuration](configuration.md): every key of `skillunit.yaml`, where the API key is read from, and the decision models.
- [Command line](cli.md): commands, options, reporters, exit codes, dry runs and borderline verdicts.
- [CI](ci.md): the GitHub Actions workflow, pull requests from forks, and what a run costs.

## Setting up by hand

The [quick start](https://github.com/Elecash/skillunit#quick-start) has a coding agent do this. To do it yourself:

```sh
npm install --save-dev skillunit
npx skillunit init skills/my-skill
```

`init` writes `skillunit.yaml`. Proof builds the skill from the files and units your tests declare: declare each file with `setup()` and each unit with `unit()`, from `skillunit/vitest`, around the test that checks what it says, or with no body for advice no test can check. Set `proof.run` to the command that type-checks those tests and runs them, build the skill, and commit it:

```yaml
skill: ./skills/my-skill
proof:
  run: "npx tsc --noEmit && npx vitest run skill.test"   # the type-check, then the test files that declare the skill: *.skill.test.ts
```

```sh
npx skillunit proof --write
```

The questions for the decision model go with their unit, in its `ask`, and a question about the prose of a file goes in `ask()`. [Writing the tests of a skill](style-guide.md) says which units to write and when a unit gets a question; [Proof](proof.md) has the API and the JSON a test in another language writes; [Questions](questions.md) has the fields of a question.

Then run both layers. The second one needs a [decision model](configuration.md#decision-models) and its key:

```sh
npx skillunit check --dry-run   # needs no key
npx skillunit check
```

The [README](https://github.com/Elecash/skillunit#readme) has the overview and the quick start. [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch) is a complete example: a small library, its skill, and the tests that declare its units and their questions.
