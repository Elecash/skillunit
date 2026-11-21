# CI

`skillunit check` runs the three layers and exits 1 when one fails. In GitHub Actions:

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
      - run: npx skillunit check --dry-run --reporter github
      - run: npx skillunit check --reporter github
```

- Sync compares the committed `skillunit.lock` with the code, so the default shallow clone is
  enough. Only `check --changed` reads git history: with it, add `with: { fetch-depth: 0 }` to
  the checkout step.
- When sync fails, a unit's code changed since it was last reviewed, or a unit is new. The
  author runs `skillunit review` on the branch, reads each change, and commits the lock with the
  change.
- `--reporter github` turns each finding into an annotation on its line in the pull request.
- The dry run needs no key. It runs lint and sync in full, and checks that every spec loads and
  fits, so a renamed heading or a broken spec fails it before the model is asked.

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
| [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch) | 6 | 15 | about 8,400 | about 730 |
| [SkillUnit's own skill](https://github.com/Elecash/skillunit/tree/main/skills/skillunit) | 7 | 52 | about 29,100 | about 2,600 |

At TypeSafe's price for Jev 1.14 on 2026-11-21, $0.042 per million input tokens with output
tokens free ([its models page](https://docs.typesafe.ai/models)), a run of tinyfetch costs
about $0.0004 and a run of SkillUnit's own skill about $0.0012.

Lint and sync make no request. `test --changed` sends only the specs a change touches.
