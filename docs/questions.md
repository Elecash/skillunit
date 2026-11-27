# Questions for the decision model

A question asks a decision model what an agent does after reading part of the skill. It is
declared in code, next to what it is about: in the `ask` of a unit, or with `ask()` for the
prose of a file. The test runner only records it; SkillUnit asks it after the build, about the
skill folder as it is committed.

## When to ask

A question is for a rule or a decision where an agent would plausibly choose wrong, and its wrong
options are the answers an agent gives without the rule. A unit with a test gets a question only
when its sentence leaves the reader something to work out: two values to combine, an exception to
apply. A fact that states one value from the code gets none: its test already proves the value,
and a question about it adds only a chance to fail on a wording.

A unit with no body, advice that no test can state, is where most questions go. The question is
then the only thing that shows the advice reaches the reader.

Write the scenario so that it pulls toward the wrong answer: the user asks for what the rule
forbids, or the shortcut is in plain sight. A plain scenario lets common sense pass the question.
And do not ask the reader to add numbers up, or to conclude from a list that what it leaves out
does not exist: what the skill must say is absent, a fact says in `unknown`.

The [style guide](style-guide.md#when-a-unit-gets-a-question) has the same rules among the others
for the tests of a skill.

## A question in its unit

Here is a unit of a deploy checklist skill and two of its questions:

```ts
import { unit } from 'skillunit/vitest';
import { PRODUCTION_BRANCH } from './deploy.js';

unit(
  'production-from-main',
  {
    when: 'the user asks to deploy to production.',
    do: `deploy from \`${PRODUCTION_BRANCH}\` only; any other branch gets a preview.`,
    ask: [
      {
        id: 'branch-to-production',
        scenario: 'The user asks to deploy the branch `feature/new-checkout` to production.',
        question: 'What does the skill say?',
        options: {
          deploy: 'Run `npm run deploy` from that branch',
          preview: `Production deploys come from \`${PRODUCTION_BRANCH}\` only; that branch can only get a preview`,
        },
        expect: 'preview',
      },
      {
        // Several phrasings of the same situation.
        scenario: [
          'CI is red on the commit the user wants to deploy, and the user says "just ship it".',
          'CI has not run yet for this commit, and the user is in a hurry.',
        ],
        question: 'What should the agent do?',
        options: {
          stop: 'Stop and say the deploy is blocked until CI is green on that commit',
          local: 'Run the tests locally and deploy if they pass',
        },
        expect: 'stop',
      },
    ],
  },
  async () => {
    // the test of the rule
  },
);
```

`ask` takes one question or a list. A unit no test can prove, such as advice, is declared with
`unit()` and no body, and takes `ask` the same way: see [Proof](proof.md#a-unit-no-test-proves).

| Field | | |
|---|---|---|
| `id` | optional | Unique across the run. The first question of a unit takes the unit's id, the next ones `<unit id>.2`, `<unit id>.3`. |
| `scenario` | required | The situation. A list of sentences gives several phrasings of it. |
| `question` | required | What the reader is asked about the situation. |
| `options` | optional | `label: description` pairs, or a list of labels. Without options the question is yes or no. |
| `expect` | required | An option label or `none`; `yes` or `no` for a question without options. |
| `with` | optional | Other files of the skill the reader gets too: a path inside the skill folder, a list of them, or `all`. See below. |
| `section` | optional | Headings of the file to send instead of the whole file. |

A question of a unit is about the file of the skill folder that holds the unit: SkillUnit finds
it there after the build.

The helper checks each question when the unit is declared: `expect` names an option, or is
`none`, or is `yes` or `no` for a question without options; the options do not list `none`; no
two questions of the file share an id. A wrong question fails the test of its unit with a message
that says what is wrong, before the body runs, and the unit is not built. A unit whose test fails
leaves no questions. An id that two test files share is reported when SkillUnit reads what
the tests left, on the second declaration.

## Build the options from the code

A question written in code can use what the code has. When an option repeats a value the code
has, build it from that value, as the unit's sentence is:

```ts
unit(
  'default-timeout',
  {
    when: 'the user asks how long a request waits by default.',
    value: `${DEFAULT_TIMEOUT / 1000} seconds (\`timeout: ${DEFAULT_TIMEOUT}\`), for every method.`,
    ask: {
      scenario: 'The user asks how long a request waits before it gives up, when the code sets nothing.',
      question: 'What should the agent answer?',
      options: {
        right: `${DEFAULT_TIMEOUT / 1000} seconds`,
        longer: `${(3 * DEFAULT_TIMEOUT) / 1000} seconds`,
        forever: 'It waits until the server answers',
      },
      expect: 'right',
    },
  },
  async () => {
    // the test of the default
  },
);
```

When `DEFAULT_TIMEOUT` changes, `skillunit proof --write` rewrites the sentence, and the next run
asks the question with the new value in its options. A name the options give comes from the code
the same way, such as `key<RequestOptions>('retry')` or `HttpError.name`. A label such as `right` stays true; a label
such as `s10` would contradict its own option the day the default changes.

## A question about prose

A question that is about no unit, such as which file the index of `SKILL.md` sends the agent to,
is declared with `ask()`:

```ts
import { ask } from 'skillunit/vitest';

ask('which-file-for-retries', {
  file: 'SKILL.md',
  scenario: 'The agent must add retries to a call.',
  question: 'Which file of the skill should it read?',
  options: { retries: 'features/retries.md', requests: 'features/requests.md', errors: 'features/errors.md' },
  expect: 'retries',
});
```

`file` is the built file the question is about, from the skill folder and inside it; it defaults
to `SKILL.md`. The id is the first argument. The other fields are those of a question in a unit.

## How a question is judged

A choice question passes when the reader ranks `expect` first, alone, with a probability of 0.5
or more. When two options or more share the top probability, the question fails, even if
`expect` is one of them: only the order the provider lists them in could pick one. The report
names them, as "a tie of stop and none". A yes/no question passes when P(yes) is at least 0.7
for an expected `yes`, or at most 0.3 for an expected `no`. The right answer under its threshold
counts as a failure; the report says "right answer, under the threshold". A verdict close to its
threshold, pass or fail, is marked borderline: see the [command line](cli.md#borderline-verdicts).
The [thresholds](configuration.md) change these numbers.

With several phrasings, each one is asked separately, and the question passes when most of them
pass: both of two, two of three, three of four. One odd phrasing cannot decide it. The report
shows one phrasing: the median, once they are ranked with the failing ones first and then by the
probability of the expected answer. Its `phrasings` line gives that probability for each, and
whether each passed.

`section` takes a heading of any level. SkillUnit sends that heading and everything under it, up
to the next heading of the same or a higher level, exactly as written. A section of one to three
thousand characters works best. A whole `SKILL.md` works too, but answers get less precise as the
text grows.

## The decision model's view

The questions about one file, with the same `section` and `with`, go in one request. Its state
is the text under test (and the `with` files), and each phrasing of each question is one question
about it, asked apart from the others. When a model takes fewer questions in one request than a
file has, SkillUnit splits them into as many requests as it needs.

SkillUnit adds a `none` option to every choice question: "the skill says something different, or
does not settle this". It gives the reader a way to say the rule is missing. Without it, the
reader would have to pick one of your options even when the skill no longer backs any of them.

## Testing with the files the agent reads

An agent seldom reads one file. It reads SKILL.md and then the reference files SKILL.md sends it
to for the task at hand. A rule missing from SKILL.md can still reach the agent through one of
those files, and a section that reads well on its own can be contradicted by one of them. `with`
gives the reader those files too:

```ts
ask('rules-reach-the-agent', {
  file: 'SKILL.md',
  section: 'Non-negotiable rules',
  with: ['features/retries.md', 'features/errors.md'],
  scenario: 'An order is created with a POST, and the network drops now and then.',
  question: 'Should the agent retry the call?',
  expect: 'no',
});
```

Paths are relative to the skill folder and stay inside it, and each file is sent whole. A path
that leaves the folder, such as `../README.md`, fails the test of the question: the agent reads
the skill, so the reader gets nothing else. `with: 'all'` sends every other `.md` file in the
skill folder.

List the files an agent opens in the situations the questions describe, not every file.
TypeSafe's accuracy falls as the state grows with text unrelated to the question
([Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13)), and a file the agent
never opens can settle a question that the agent would get wrong. Keep `all` for small skills.

Each decision model has a limit on the state plus the longest question; TypeSafe's is 32,000
tokens, and OpenAI's is 922,000 for the whole request. SkillUnit estimates the size before
sending and refuses a request that would not fit, naming its largest files. `--dry-run` prints
in `TOKENS` the estimate of the whole request, every question counted with the instructions,
which is what a run bills. It is an estimate, from the length of the text: the billed count can
be some percent higher or lower.

Keep questions without `with` as well. The two answer different questions:

- Without `with`: does this section state the rule clearly? A failure points at the sentence to
  fix.
- With `with`: does the rule reach the agent from what it reads? A failure means the agent is
  likely to get it wrong.

A question that fails alone and passes with `with` means the rule reaches the agent only through
another file. Decide whether SKILL.md should state it too.

### Compared with real agents

A forms library's skill has a rule about where a form's named states go, stated in SKILL.md and
repeated in two reference files. We made two copies of the skill, one with the rule deleted from
SKILL.md only and one with it deleted from every file. For each copy, eight Claude Haiku agents
wrote a form with a named state and a script checked where they put it. SkillUnit asked the same
three questions about each copy, in three ways:

| Copy of the skill | Agents right | Failed: section only | with the two files | with `all` |
|---|---|---|---|---|
| Unchanged | 8 of 8 | 0 of 3 | 0 of 3 | 0 of 3 |
| Rule deleted from SKILL.md | 8 of 8 | 3 of 3 | 0 of 3 | 0 of 3 |
| Rule deleted from every file | 0 of 8 | 3 of 3 | 3 of 3 | 2 of 3 |

With the files the agents read, the questions matched the agents on all three copies. Asked
alone, the section flagged the second copy although every agent got it right there, because the
rule still reached them through a reference file. With `all`, the extra files made the answers
less certain, and on the last copy one question passed at 0.52 while every agent failed. This is
one rule, one model and eight runs per copy: a first comparison, not a benchmark.

## Best practices

Each practice below comes from a question that passed for the wrong reason while SkillUnit was
being built. Together they are what makes a question fail when its rule is removed from the skill.

**Ask about decisions.** "Does the skill mention two APIs?" passes even when the section is badly
written. "The user asks for X. What does the agent do first?" fails as soon as the text stops
leading to the answer.

**Offer the tempting wrong answer.** An option nobody would pick teaches nothing. The wrong
options should be the ones an agent would reach for if the rule were missing: deploy anyway, run
the tests locally, pick the default.

**Prefer choice questions to yes/no.** A yes/no question has no `none`. When the skill says
nothing, the reader may answer from common sense, so a rule that common sense agrees with ("never
put the API key in the config") passes with the rule deleted. Asked as a choice ("where should
the key go?"), the same question answers `none` when the rule is gone. A yes/no question that
stays asks about one action of the agent, not about the text:

| Instead of | Ask |
| --- | --- |
| Does the skill ask for a client here? | Should the agent create a client with `create` for this request? |
| Is `retry` mentioned for PUT? | May the agent pass `retry` to that call? |

**Ask where the rule does not apply.** If the rule is "ask which API before writing code", also
ask about a request that already names the API. Otherwise you only check that the agent asks,
never that it stops asking when it should.

**Ask where the rule allows, not only where it forbids.** Caution is common sense, so a question
about the forbidden case often survives a weakened rule. In tinyfetch, blurring the rule "enable
`retry` only for GET, HEAD, PUT and DELETE" left the POST question passing at 0.94; the PUT
question, where `retry` is allowed, fell to `none` and failed.

**Make each option say everything the skill says on the point.** The options should differ only
in what the question checks. When the skill says to quote a command in backticks *and* ask for it
"exactly as written", an expected option that mentions only the second half leaves the reader
unsure, and it gives the rest to `none`.

**Ask what the skill leaves out.** `expect: 'none'` checks that the reader does not stretch the
skill to cover a case it never mentions, like database migrations in a deploy checklist.

**Expect `none` only where the skill should be silent.** `none` means both "the skill says
something else" and "the skill says nothing". If the skill does give an answer and none of your
options says it, add an option that does and expect it. A question that expects `none` because
the options do not match the skill passes just the same when the rule is deleted: the reader
answers `none` because the skill is now silent.

**Ask for exact values when they matter.** The reader compares meaning, and `npm run preview`
and `npm run deploy:preview` mean the same thing. Ask for the command "exactly as written" and
the reader compares character by character; if the skill names a different command, it answers
`none`. For spelling that must never change (a package name, a flag, a URL), a plain `grep` in
the same CI job is cheaper still.

**Keep phrasings away from the skill's own examples.** A scenario that repeats an example from
the skill passes on the example alone and tells you nothing about the rule behind it.

### Fixing the skill when a question fails

**Put an exception next to the rule it changes.** A reader, like an agent, follows the most
specific rule it finds. A forms library's skill said "every validator without a choice list
takes no `type`", a rule for its TypeScript API; its JSON definitions need a `type` on every
validator. Stating the JSON exception at the top of the section did not help: the reader still
answered "no `type`" at 83%. The same sentence, moved into the rule as a note, made it answer
"`type`" at 99%.

**Write each fact in one place.** When the skill says the same thing twice, deleting one copy
changes nothing, so no question can show that either copy matters, and every request pays for
both.

**Add the idea the rule is missing, not the question's words.** If a question fails because the
rule does not cover a case, write the general reason that covers it. Copying the scenario's
wording into the skill makes that one question pass and teaches the reader nothing about the next
phrasing.

## When an agent got something wrong

An agent that used the skill did the wrong thing. Fix the skill from a question, in this order:

1. **Write the question that reproduces it, before any change to the skill.** Its scenario is the
   situation the agent was in, its wrong options are what the agent did, and `expect` is what it
   should have done.
2. **Ask it.** It has to fail, or at least come out borderline. A red verdict on the option the
   agent chose says the text led it there.
3. **If it passes, the text is clear to a reader, and the cause is somewhere else.** Ask the agent
   that went wrong why. It may never have read that file: the question is then about the row of
   the index that should have sent it there, or about the file it did read.
4. **Change the unit until the question passes, clear of the threshold.** A borderline pass means
   the unit does not say it yet. Look at what the scenario has that the unit does not answer: when
   the user asks for the very thing the rule forbids, that goes in `evenWhen`.
   [Fixing the skill when a question fails](#fixing-the-skill-when-a-question-fails) has more.
5. **Try the changed skill with an agent on the task that went wrong.** SkillUnit checks the
   skill, not the agent, so this step is outside it.

Writing the question after the fix skips the red. A question that has never failed may pass on
the old text as well, and then it says nothing about the mistake.

These steps were tried on three mistakes that agents made with the skill of another library.
Each question came out red, on the answer the agents had given. One unit added made one of them
pass on both models. Another stayed on the threshold until an `evenWhen` answered what the user
of its scenario asked for.

### An example from tinyfetch

tinyfetch joins a path after the whole of `baseUrl` as text. An agent asked to set an API key once,
on the client, puts it at the end of `baseUrl`, and every request loses it:
`create({ baseUrl: "https://api.example.com/v1?api_key=K" }).get("/users")` goes to `/v1` with
`api_key` set to `K/users`. The skill said nothing about it.

The question, declared with `ask()` in `src/skill/clients.test.ts`, before any change to the
skill:

```ts
ask('key-in-the-query', {
  scenario: `Every request to an API needs the query parameter \`api_key\`. The code makes one client with \`${exported('create')}\` for that API, and the user asks for the key to be set once, on the client.`,
  question: 'Where does the agent put the key?',
  options: {
    base: `At the end of \`${clientOpt('baseUrl')}\`: \`"${KEYED}"\``,
    query: `In the \`${reqOpt('query')}\` of each request: \`{ ${reqOpt('query')}: { api_key: K } }\``,
  },
  expect: 'query',
});
```

`npx skillunit test` on the skill as it was, on `typesafe`, 2026-11-27:

```
    test   ✗ src/skill/clients.test.ts:90  key-in-the-query  none 0.89
             scenario:  Every request to an API needs the query parameter `api_key`. The code makes one client with `create` for that API, and the user asks for the key to be set once, on the client.
             question:  Where does the agent put the key?
             expected:  query
             got:       none · probability 0.89, threshold 0.50 · wrong answer
                        none 89% · base 10% · query 1%
```

Red, on `none`: the skill did not say where the key goes. The fix is a rule,
`no-query-in-base-url`, whose body asserts the URL above and that a client takes no `query`. The
question moved into its `ask`:

```md
### rule: no-query-in-base-url

When: a key or another query parameter goes on every request of a client.

Do: pass it in the `query` of each request, or in the `headers` of the client when the API takes it as a header; never put it at the end of `baseUrl`. A path is joined after the whole of `baseUrl` as text: with `baseUrl: "https://api.example.com/v1?api_key=K"`, `get("/users")` goes to `/v1` with `api_key` set to `K/users`.

Even when: the user asks for the key to be set once, on the client: a client takes `baseUrl`, `headers` and `timeout`, and no `query`.
```

The same question, after `npx skillunit proof --write`:

```
    no-query-in-base-url  rule
      test   ✓ src/skill/clients.test.ts:93  key-in-the-query  query 0.78
```

Green at 0.78, clear of the 0.63 that the default threshold and margin put the edge of
borderline at. The last step, an agent with the changed skill on that task, is outside SkillUnit.
