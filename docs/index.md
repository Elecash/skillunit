# SkillUnit docs

- [Style guide](style-guide.md): how to write a skill in units, how to lay out its files, and its index.
- [Questions](questions.md): where the questions for the decision model go, their fields, `with`, how to write one that fails when its rule is gone, and how to check that it does.
- [Proof](proof.md): units declared in the project's tests with `unit()`, those no test proves, the source the skill is built from, which tests `proof.run` runs, the JSON a test in another language writes, and what proof does not do.
- [Configuration](configuration.md): every key of `skillunit.yaml`, where the API key is read from, and the decision models.
- [Command line](cli.md): commands, options, reporters, exit codes, dry runs and borderline verdicts.
- [CI](ci.md): the GitHub Actions workflow, pull requests from forks, and what a run costs.

The [README](https://github.com/Elecash/skillunit#readme) has the overview and the quick start. [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch) is a complete example: a small library, its skill, and the tests that declare its units and their questions.
