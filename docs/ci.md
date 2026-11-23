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
      TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      # The tests write the JUnit report the proof layer reads; leave this out without `proof`.
      - run: npx vitest run --reporter=default --reporter=junit --outputFile.junit=reports/junit.xml
      - run: npx skillunit check --dry-run --reporter github
      - run: npx skillunit check --reporter github
```

- The default shallow clone is enough. Only `check --changed` reads git history: with it, add
  `with: { fetch-depth: 0 }` to the checkout step.
- With `proof` in `skillunit.yaml`, run the tests with a JUnit reporter before `check`, and
  empty the examples folder before they run. A failing test fails its own step first; `check`
  then names the unit it proves. [Proof](proof.md#wiring-a-test-run) has the reporter for
  Vitest, Jest and pytest.
- Commit `skillunit.lock` with the change that tags or untags a test: CI never writes it. A test
  that proves a unit the lock does not list fails the check, and so does a unit the lock lists
  that no test proves. Run every test in this step: a listed unit whose test a partial run left out fails.
- `--reporter github` turns each finding into an annotation on its line in the pull request.
- The dry run needs no key. It runs lint and proof in full, and checks that every spec
  loads and fits, so a renamed heading or a broken spec fails it before the model is asked.

## Pull requests from forks

GitHub gives no secrets to a workflow run from a fork, so the second step has no key there. Run
only the dry run for forks, for example with
`if: github.event.pull_request.head.repo.full_name == github.repository` on the second step, and
run the full check once the change is merged or pushed to a branch of the repository.

A decision model can answer a test differently from one run to the next. A test that flips is a
finding to look at, usually a borderline one, not a run to retry until it passes.

## What a run costs

Each spec is one request to the decision model, whatever the number of tests in it, and the
request carries the text under test once. Measured in November 2026:

| Skill | Specs | Tests | Input tokens | Output tokens |
| --- | --- | --- | --- | --- |
| [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch) | 6 | 16 | about 8,700 | about 830 |
| [SkillUnit's own skill](https://github.com/Elecash/skillunit/tree/main/skills/skillunit) | 8 | 57 | about 29,600 | about 2,800 |

At TypeSafe's price for Jev 1.14 on 2026-11-21, $0.042 per million input tokens with output
tokens free ([its models page](https://docs.typesafe.ai/models)), a run of tinyfetch costs
about $0.0004 and a run of SkillUnit's own skill about $0.0012.

Lint and proof make no request. `test --changed` sends only the specs a change touches.
