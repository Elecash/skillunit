# SkillUnit docs

- [Style guide](style-guide.md): how to write a skill in units, how to lay out its files, and its index.
- [Writing specs](writing-specs.md): the spec format, `with`, how to write a test that fails when its rule is gone, and how to check that it does.
- [Proof](proof.md): units declared in the project's tests with `unit()`, the source the skill is built from, the JSON a test in another language writes, and what proof does not do.
- [Configuration](configuration.md): every key of `skillunit.yaml`, where the API key is read from, and the decision models.
- [Command line](cli.md): commands, options, reporters, exit codes, dry runs and borderline verdicts.
- [CI](ci.md): the GitHub Actions workflow, pull requests from forks, and what a run costs.

The [README](https://github.com/Elecash/skillunit#readme) has the overview and the quick start. [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch) is a complete example: a small library, its skill in units, and its specs.
