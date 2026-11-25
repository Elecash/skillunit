# CI

`skillunit check` runs lint, proof and test, and exits 1 when one fails. In GitHub Actions:

```yaml
# .github/workflows/skill.yml
name: skill
on: [pull_request]
jobs:
  skillunit:
    runs-on: ubuntu-latest
    env:
      # The key of the provider in use: OPENAI_API_KEY for `openai`.
      TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      # Runs the tests through `proof.run`, builds the skill and compares it; sends nothing.
      - run: npx skillunit check --dry-run --reporter github
      # The same, and the questions asked; `--no-run` uses the units the step above left.
      - run: npx skillunit check --no-run --reporter github
```

- The default shallow clone is enough. Only `check --changed` reads git history: with it, add
  `with: { fetch-depth: 0 }` to the checkout step.
- With `source` and `proof.run` in `skillunit.yaml`, `check` runs the tests that declare units
  itself and goes on when they fail, so a failing test is reported on the unit it declares, then
  fails: a run that did not exit with 0 is an error, with the end of its output. Point
  `proof.run` at those tests only, such as `npx vitest run skill.test`, and let the project's own
  test job run the whole suite. A project that runs those tests in a step of its own runs
  `check --no-run` after it, with `if: always()` on the `check` step so a red test step does not
  skip it.
- CI never writes the skill folder. A change that moves a value the skill states fails the check
  until someone runs `skillunit proof --write` and commits the result.
- `--reporter github` turns each finding into an annotation on its line in the pull request.
- Set the key of the provider in `skillunit.yaml` as a repository secret: `TYPESAFE_API_KEY` for
  `typesafe`, `OPENAI_API_KEY` for `openai`. Only that one is needed.
- The dry run needs no key. It runs lint and proof in full, and checks that every question can
  be asked and fits, so a renamed heading, a question whose `expect` names no option, or a unit
  missing from the skill fails it before the model is asked.

## Pull requests from forks

GitHub gives no secrets to a workflow run from a fork, so the second step has no key there. Run
only the dry run for forks, for example with
`if: github.event.pull_request.head.repo.full_name == github.repository` on the second step, and
run the full check once the change is merged or pushed to a branch of the repository.

`typesafe` can answer a question differently from one run to the next. A question that flips is a
finding to look at, usually a borderline one, not a run to retry until it passes. `openai`
answers the same request with the same numbers, so on it a verdict changes only when the skill
or the question does.

## What a run costs

The questions about one file of the skill go in one request to the decision model, whatever
their number, and the request carries the text under test once. Measured on 2026-11-25:

| Skill | Requests | Questions | `typesafe`: input / output tokens | `openai`: input / output tokens |
| --- | --- | --- | --- | --- |
| [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch) | 6 | 16 | about 8,600 / 830 | about 7,900 / 0 |
| [SkillUnit's own skill](https://github.com/Elecash/skillunit/tree/main/skills/skillunit) | 8 | 58 | about 30,200 / 2,900 | about 30,400 / 0 |

Output tokens are free on both. At the prices of November 2026:

| Provider | Price per million input tokens | A run of tinyfetch | A run of SkillUnit's own skill |
| --- | --- | --- | --- |
| `typesafe`, Jev 1.14 ([models page](https://docs.typesafe.ai/models), 2026-11-21) | $0.042 | about $0.0004 | about $0.0013 |
| `openai`, `gpt-6-luna` ([guide](https://developers.openai.com/api/docs/guides/decisions), 2026-11-23) | $0.10 | about $0.0008 | about $0.0030 |

OpenAI caches the start of a request that holds 1,024 tokens or more of skill text. A request
sent again within 30 minutes then pays 10% for that part, and the first request pays 25% more
for writing it. Most requests carry less text than that, so caching changes a run's cost by a
few percent at most.

Lint and proof make no request. `--changed` sends only the questions about the files a change
touches.
