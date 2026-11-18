---
name: alchemist
description: Write and run Alchemist specs, the YAML unit tests that check an agent skill (a SKILL.md) leads to the decisions it was written for. Use when asked to test a skill, to add or fix Alchemist tests, or to check that a SKILL.md still says what it should.
---

# Writing Alchemist specs

Alchemist tests a skill by asking a reader model closed questions about the skill's text. A spec
is a YAML file with the tests for one part of a skill. Each test is a situation, a question and
a short list of answers, one of them expected. The test passes when the text leads the reader to
the expected answer.

Your job is to write tests that fail when the skill stops saying what it should. A test that
passes on any version of the skill is worse than no test, because it looks like protection.

## Set up

If the project has no `alchemist.yaml`, run `npx alchemist init <skill folder>`. It creates
`alchemist.yaml` next to SKILL.md and a first spec in `alchemist/`. Set `context` in
`alchemist.yaml` to one sentence about what the skill is for.

The TypeSafe API key goes in `.env` or the environment as `TYPESAFE_API_KEY`, never in a spec or
in `alchemist.yaml`. If there is no key, write the specs anyway, run only `--dry-run`, and tell
the user the tests have not been sent.

## Plan the specs

A skill is SKILL.md plus every file it tells the agent to read, such as `references/*.md`.
Every one of those files gets its own specs, named after it (`forms-json.yaml`, or
`forms-json-validation.yaml` when the file is split), with `file` set to its path. A rule that
lives only in a referenced file is tested there, not through SKILL.md.

Write one spec per heading, with `section` set to that heading. Keep the tested text
under about 3,000 characters: when a heading is longer, write one spec per subheading. Leave
`section` out and test the whole file only when the skill is short.

An agent reads SKILL.md together with the files it points to for the task at hand, so a rule
can reach the agent from another file. For the rules where a mistake costs most, add a spec with
`with` that lists the files SKILL.md sends the agent to in the situations the tests describe.
List those files only; `with: all` adds text the agent never reads, which makes the answers less
reliable, so keep it for a skill of a few files. Keep the spec without `with` as well: it shows
whether the section states the rule itself.

Before writing tests, read the section and list the decisions it forces: the places where an
agent that read it would act differently from one that did not. A sentence that changes nothing
an agent does needs no test. If the user has not said which parts matter, show them the list
before writing the tests.

## Write a test

Give each decision one test:

- `scenario` describes the situation as the agent meets it. It never contains the rule or the
  reason for it. "Production is down and the user has a fix ready" is a scenario. "Production is
  down, and a rollback is faster than a fix" gives the answer away.
- `question` asks what the agent should do, or what the skill says to do. Ask about an action,
  never about the text: "What should the agent do first?", not "Does the skill mention
  rollbacks?".
- Prefer a test with `options`. A test without them is a yes/no test (`expect: yes` or
  `expect: no`), and it has no `none`: when the skill is silent, the reader answers from common
  sense, so a rule that common sense agrees with passes without the skill. Use yes/no only for
  a decision with exactly two outcomes that common sense would get wrong.

When users will describe the situation in many ways, give `scenario` a list of two to four
phrasings. Write them in the user's words. Never reuse the skill's own examples as phrasings: a
phrasing that repeats an example passes on the example alone.

Each spec also needs:

- A negative test for every rule with a limit: a situation where the rule does not apply, so the
  agent must not follow it.
- At least one test for a nearby situation the skill does not cover, such as a related task it
  never mentions. Write it even though the skill says nothing there: its `expect` is `none`, and
  it catches a reader that stretches a rule to fit instead of saying the skill is silent.

## Choose the options

Offer two to four options: the expected answer and the wrong answers an agent would pick if the
rule were missing, such as the shortcut, the default, or doing literally what the user asked.
An option nobody would pick lets the right answer win by elimination.

Label options with short lowercase words (`stop`, `deploy`, `preview`) and put the meaning in the
description.

Never define an option called `none`, and never add one that means "other" or "the skill does not
say". Alchemist adds `none` to every choice test by itself, and a spec that defines it does not
load.

`none` means both "the skill says something else" and "the skill says nothing". Expect it only
when the skill should be silent. When the skill does give an answer, make that answer an option
and expect the option, even if you have to add it: a test that expects `none` because no option
matches the skill also passes when the rule is deleted.

When the exact value matters, such as a command, a file name or a flag, quote it in backticks in
the options and ask for it "exactly as written". Otherwise the reader compares meaning and
accepts a renamed command.

## Check the tests

1. Run `npx alchemist run --dry-run`. It sends nothing and fails when a spec is invalid, a
   heading does not exist, or a spec is too large to send. Fix and repeat until it passes.
2. Run `npx alchemist run`.
3. Prove that each test depends on its rule. Copy the skill folder to a temporary location,
   delete the rule's sentence in the copy, and run `npx alchemist run <spec> --skill <copy>`.
   The test must fail. Never edit the real SKILL.md for this check.
4. If a test still passes without its sentence, find out why, in this order: an option gives
   the answer away, the scenario contains the answer, the skill states the same rule somewhere
   else, or the reader knows the answer without the skill. Fix the test in the first two cases.
   In the last two, tell the user: the rule is written twice, or the sentence may not be
   needed at all.

Alchemist has no mutations. If the user asks for them, explain that step 3 does the same job.

## When a test fails on the real skill

When a test fails on the unmodified skill, either the test is wrong or the skill does not say
what it should. The distribution in the output tells you which:

- `none` is high: the reader did not find the rule in the text.
- A wrong option is high: the text points to that answer.
- The expected answer is marked `~ (weak)`: the text is ambiguous.

Never change a test only to make it pass, and never lower the thresholds. If the test is right,
the skill needs the fix. When the user has asked you to improve the skill, edit SKILL.md and run
the test again. Otherwise, leave SKILL.md as it is, report the failure as a finding about the
skill, and suggest the sentence that would fix it.

When you write the fix, put an exception next to the rule it changes, never in an introduction
or a separate note: the reader follows the most specific rule it finds, so an exception stated
earlier loses to the rule below it. Add the idea the rule is missing, not the test's wording.

## Spec format

```yaml
file: SKILL.md              # optional; SKILL.md by default
section: A heading          # or a list of headings; leave out for the whole file
with: [references/a.md]     # optional; other files the agent reads too, sent whole, or all
tests:
  - id: kebab-case-id
    scenario: The situation.            # or a list of phrasings
    question: What should the agent do?
    options:                            # leave out for a yes/no test
      label: What this answer means
    expect: label                       # an option label or none; yes or no when there are no options
```

These are the only keys; any other key is an error.

Quote a value in double quotes when it contains `: ` or starts with a backtick, a `{` or a `[`,
and in single quotes when it also contains double quotes. Write a heading that contains a comma
as a block list item, since a comma splits `[a, b]`. Run `--dry-run` after every edit: it
reports the file and line of any YAML error. Leave the thresholds at their defaults
unless the user asks to change them.
