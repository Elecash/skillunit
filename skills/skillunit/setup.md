# SkillUnit — setting up a project

The settings file, the decision model, and its key.

## Rules

### fact: init

When: the project has no `skillunit.yaml` yet.

Value: `skillunit init <skill folder>` writes `skillunit.yaml` in the current folder, with `skill` set to that folder. It refuses when the file is there already, and it writes no `SKILL.md`: the first `proof --write` builds it. In a folder with a `tsconfig.json`, the `proof.run` it suggests in a comment type-checks first: `npx tsc --noEmit && npx vitest run skill.test`. In a folder with no `package.json`, it also points at the JSON contract, which a test in another language writes.

### fact: settings-keys

When: the code writes or reads `skillunit.yaml`.

Value: `skillunit.yaml` takes `skill`, `context`, `model`, `thresholds` and `proof`, and refuses any other key. Each path in it starts from the folder of the file. With no settings file, the skill is the current folder.

```yaml
skill: ./skills/my-skill
context: "A client for JSON APIs."
proof:
  run: "npx vitest run skill.test"
```

### fact: proof-settings

When: the settings set `proof`.

Value: `proof` takes `run`, `units` and `format`, and no other key. `proof.run` is the command that runs the tests, through the shell, from the folder of `skillunit.yaml`. `proof.units` is where the tests leave their records, `./tmp/skill-units` by default. `proof.format` is a command with `{file}`, run once with every built Markdown file in its place.

### fact: proof-run-must-pass

When: `proof.run` runs tests that fail.

Value: the proof fails when `proof.run` exits with anything but 0, even when its tests left every record the build needs.

### rule: type-check-in-run

When: the tests take names from the types with `key()`, or pass options typed by the code.

Do: start `proof.run` with the type-check of the test files, as `npx tsc --noEmit && npx vitest run skill.test`. Vitest strips the types, so a name the code no longer has fails no test, only the type-check.

### fact: providers

When: the settings choose the decision model, or a command overrides them.

Value: SkillUnit ships `typesafe` (key in `TYPESAFE_API_KEY`) and `openai` (key in `OPENAI_API_KEY`). `model: { provider: <provider>, name: <model> }` chooses one in the settings, `--provider` chooses one for a single run, and `--model` the model.

### fact: api-keys

When: a command that asks the decision model needs its key.

Value: `test` and `check` read the key from the environment, or from a `.env` file next to `skillunit.yaml` or in a folder above it, up to the root of the git repository; with no git repository above it, only the `.env` next to it. A variable set in the environment wins over a file, and a closer file wins over a farther one. With `--dry-run`, they need no key.

### fact: own-model

When: the decision model is not one SkillUnit ships.

Value: `model` can be the path of a module, starting with `./` or `/`. The module exports, as its default export or as `model`, an object with `id`, `limits` and `decide`, or a function that returns one.

### fact: thresholds

When: the settings or a command set a threshold.

Value: the thresholds a verdict is judged with default to `choice` 0.5, `yes` 0.7, `no` 0.3 and `margin` 0.13. `yes` must be 0.5 or more and `no` under 0.5. `--choice`, `--yes`, `--no` and `--margin` override them for one run.

### rule: key-outside-the-repo

When: a key of a decision model has to reach a command, on a machine or in CI.

Do: keep it in the environment, or in a `.env` file that git ignores; in CI, give it as a secret. Never write it into `skillunit.yaml` or a file git tracks.

Even when: the user asks for the key to work for the whole team: each person sets their own, and CI reads the secret.
