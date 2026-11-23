# Writing specs

A spec is a YAML file with the tests for one part of a skill. It holds data only, so it reads
well in a diff and can be generated. Here is part of a spec for a deploy checklist skill:

```yaml
file: SKILL.md                          # file in the skill folder (default: SKILL.md)
section: [Before you deploy, Which command]   # headings to test; leave out for the whole file
# with: [references/rollback.md]        # other files the reader gets too; see below

tests:
  - id: branch-to-production
    unit: production-from-main          # the unit the test is about; see below
    scenario: The user asks to deploy the branch `feature/new-checkout` to production.
    question: What does the skill say?
    options:
      deploy: "Run `npm run deploy` from that branch"
      preview: "Production deploys come from `main` only; that branch can only get a preview"
    expect: preview

  - id: red-ci-blocks                   # several phrasings of the same situation
    scenario:
      - CI is red on the commit the user wants to deploy, and the user says "just ship it".
      - CI has not run yet for this commit, and the user is in a hurry.
    question: What should the agent do?
    options:
      stop: Stop and say the deploy is blocked until CI is green on that commit
      local: Run the tests locally and deploy if they pass
    expect: stop

  - id: migrations-not-covered          # the skill should be silent here
    scenario: Before deploying, the user asks the agent to run the database migrations.
    question: Which command does the skill give for running migrations?
    options: { deploy: "`npm run deploy`", preview: "`npm run deploy:preview`", rollback: "`npm run rollback`" }
    expect: none

  - id: preview-needs-tag               # no options: a yes/no test
    scenario: The user wants a preview URL for a branch that has no version tag.
    question: Does the preview need a tag?
    expect: no
```

| Field | | |
|---|---|---|
| `id` | required | Unique in the file. |
| `unit` | optional | The id of the unit the test is about. A failure shows it. |
| `scenario` | required | The situation. A list of sentences gives several phrasings of it. |
| `question` | required | What the reader is asked about the situation. |
| `options` | optional | `label: description` pairs, or a list of labels. Without options the test is yes/no. |
| `expect` | required | An option label or `none`; `yes` or `no` for a yes/no test. |

A choice test passes when the reader picks `expect` with a confidence of 0.5 or more. A yes/no
test passes when P(yes) is at least 0.7 for an expected `yes`, or at most 0.3 for an expected
`no`. The right answer with too little confidence counts as a failure; the report says "right
answer, too little confidence". A verdict close to its threshold, pass or fail, is marked
borderline: see the [command line](cli.md#borderline-verdicts).

With several phrasings, each one is asked separately. SkillUnit ranks them by the probability of
the expected answer and takes the median, so one odd phrasing cannot decide the test but half of
them can.

`section` takes a heading of any level. SkillUnit sends that heading and everything under it, up
to the next heading of the same or a higher level, exactly as written. A section of one to three
thousand characters works best. A whole `SKILL.md` works too, but answers get less precise as the
text grows.

## The decision model's view

Each spec is one request. Its state is the text under test (and the `with` files), and each
phrasing of each test is one question about it, asked apart from the others. SkillUnit adds a
`none` option to every choice test: "the skill says something different, or does not settle
this". It gives the reader a way to say the rule is missing. Without it, the reader would have
to pick one of your options even when the skill no longer backs any of them.

## Testing with the files the agent reads

An agent seldom reads one file. It reads SKILL.md and then the reference files SKILL.md sends it
to for the task at hand. A rule missing from SKILL.md can still reach the agent through one of
those files, and a section that reads well on its own can be contradicted by one of them. `with`
gives the reader those files too:

```yaml
file: SKILL.md
section: Non-negotiable rules
with: [features/retries.md, features/errors.md]
```

Paths are relative to the skill folder, and each file is sent whole. `with: all` sends every
other `.md` file in the skill folder.

List the files an agent opens in the situations the tests describe, not every file. TypeSafe's
accuracy falls as the state grows with text unrelated to the question
([Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)), and a file the agent
never opens can settle a test that the agent would get wrong. Keep `all` for small skills.

Each decision model has a limit on the state plus the longest question; TypeSafe's is 32,000
tokens. SkillUnit estimates the size before sending, prints it with `--dry-run`, and refuses a
spec that would not fit, naming its largest files. The estimate runs about 8% high.

Keep the specs without `with` as well. The two answer different questions:

- Without `with`: does this section state the rule clearly? A failure points at the sentence to
  fix.
- With `with`: does the rule reach the agent from what it reads? A failure means the agent is
  likely to get it wrong.

A test that fails alone and passes with `with` means the rule reaches the agent only through
another file. Decide whether SKILL.md should state it too.

### Compared with real agents

A forms library's skill has a rule about where a form's named states go, stated in SKILL.md and
repeated in two reference files. We made two copies of the skill, one with the rule deleted from
SKILL.md only and one with it deleted from every file. For each copy, eight Claude Haiku agents
wrote a form with a named state and a script checked where they put it. SkillUnit ran the same three tests on each copy, in three ways:

| Copy of the skill | Agents right | Tests failed: section only | with the two files | with `all` |
|---|---|---|---|---|
| Unchanged | 8 of 8 | 0 of 3 | 0 of 3 | 0 of 3 |
| Rule deleted from SKILL.md | 8 of 8 | 3 of 3 | 0 of 3 | 0 of 3 |
| Rule deleted from every file | 0 of 8 | 3 of 3 | 3 of 3 | 2 of 3 |

With the files the agents read, the tests matched the agents on all three copies. Tested alone,
the section flagged the second copy although every agent got it right there, because the rule
still reached them through a reference file. With `all`, the extra files made the answers less
certain, and on the last copy one test passed at 0.52 while every agent failed. This is one rule,
one model and eight runs per copy: a first comparison, not a benchmark.

## Best practices

Each practice below comes from a test that passed for the wrong reason while SkillUnit was being
built. Together they are what makes a test fail when its rule is removed from the skill.

**Ask about decisions.** "Does the skill mention two APIs?" passes even when the section is badly
written. "The user asks for X. What does the agent do first?" fails as soon as the text stops
leading to the answer.

**Offer the tempting wrong answer.** An option nobody would pick teaches nothing. The wrong
options should be the ones an agent would reach for if the rule were missing: deploy anyway, run
the tests locally, pick the default.

**Prefer choice tests to yes/no.** A yes/no test has no `none`. When the skill says nothing, the
reader answers from common sense, so a rule that common sense agrees with ("never put the API key
in the config") passes with the rule deleted. Asked as a choice ("where should the key go?"), the
same test answers `none` when the rule is gone.

**Test where the rule does not apply.** If the rule is "ask which API before writing code", also
test a request that already names the API. Otherwise you only check that the agent asks, never
that it stops asking when it should.

**Test where the rule allows, not only where it forbids.** Caution is common sense, so a test of
the forbidden case often survives a weakened rule. In tinyfetch, blurring the rule "enable
`retry` only for GET, HEAD, PUT and DELETE" left the POST test passing at 0.94; the PUT test,
where `retry` is allowed, fell to `none` and failed.

**Make each option say everything the skill says on the point.** The options should differ only
in what the test checks. When the skill says to quote a command in backticks *and* ask for it
"exactly as written", an expected option that mentions only the second half leaves the reader
unsure, and it gives the rest to `none`: SkillUnit's own test of that rule failed for too
little confidence (0.44 and 0.43) with the incomplete option, and passed at 0.86 or more once
both options carried the backticks.

**Test what the skill leaves out.** `expect: none` checks that the reader does not stretch the
skill to cover a case it never mentions, like database migrations in a deploy checklist.

**Expect `none` only where the skill should be silent.** `none` means both "the skill says
something else" and "the skill says nothing". If the skill does give an answer and none of your
options says it, add an option that does and expect it. A test that expects `none` because the
options do not match the skill passes just the same when the rule is deleted: the reader answers
`none` because the skill is now silent. SkillUnit's own skill had such a test; it passed at 0.80
with its rule and at 0.55 without it.

**Ask for exact values when they matter.** The reader compares meaning, and `npm run preview`
and `npm run deploy:preview` mean the same thing. Ask for the command "exactly as written" and
the reader compares character by character; if the skill names a different command, it answers
`none`. For spelling that must never change (a package name, a flag, a URL), a plain `grep` in
the same CI job is cheaper still.

**Keep phrasings away from the skill's own examples.** A scenario that repeats an example from
the skill passes on the example alone and tells you nothing about the rule behind it.

### Fixing the skill when a test fails

**Put an exception next to the rule it changes.** A reader, like an agent, follows the most
specific rule it finds. A forms library's skill said "every validator without a choice list
takes no `type`", a rule for its TypeScript API; its JSON definitions need a `type` on every
validator. Stating the JSON exception at the top of the section did not help: the reader still answered
"no `type`" at 83%. The same sentence, moved into the rule as a note, made it answer "`type`"
at 99%.

**Write each fact in one place.** When the skill says the same thing twice, deleting one copy
changes nothing, so no test can show that either copy matters, and every request pays for both.

**Add the idea the rule is missing, not the test's words.** If a test fails because the rule
does not cover a case, write the general reason that covers it. Copying the scenario's wording
into the skill makes that one test pass and teaches the reader nothing about the next phrasing.

## Checking that a test is real

A green test proves the reader gave the right answer. To prove it gave it *because of the
skill*, copy the skill, delete the sentence or the unit the test is about in the copy, and run
the spec against the copy with `--skill`. The test should fail.

In November 2026, every unit of SkillUnit's own skill was deleted in turn from a copy, and its
spec run against it. 29 of the 44 tests that name a unit failed without it. Most of the 15 that
still passed did so because the file's reference text already describes what the unit
instructs: the rule is written twice, once as how the tool works and once as an instruction.
A few, such as "make every example compile", are common sense.

If a test stays green, look for the cause in this order:

1. An option gives the answer away. Replace it with a wrong answer an agent would really pick.
2. The scenario contains the answer, such as the rule's reason or its exception. Remove it.
3. The skill states the rule somewhere else, and the reader found the other copy. Keep the copy
   if it is deliberate, or delete it and save the tokens on every request.
4. The reader knows the answer without the skill. The test shows the skill agrees with common
   sense; it cannot show the sentence is needed. Consider whether the sentence is.
