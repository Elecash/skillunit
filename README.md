# SkillUnit

[![CI](https://github.com/Elecash/skillunit/actions/workflows/ci.yml/badge.svg)](https://github.com/Elecash/skillunit/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/skillunit)](https://www.npmjs.com/package/skillunit)

The API changes, the skill does not, and agents keep writing code for the version the skill describes. Nothing fails, so nobody notices.

**SkillUnit builds your agent skill from your tests**. Each instruction is declared in the test that checks it, and each example is code that test ran. When the code changes, the skill changes with it, and CI fails until the skill in the repository is the new one. It is for skills that describe code, such as a library, an API, a CLI or an SDK.

It works in two layers, and each covers what the other cannot:

- **Proof** covers what your tests can prove: a default, what an error carries, which requests are retried.
- **Test** covers what they cannot: advice about something outside the code, or a call that is the user's to make. A decision model reads the skill and has to reach the right answer.

**SKILLUNIT DOES NOT CHECK WHETHER AN AGENT FOLLOWS THE SKILL.** No check can promise that: an
agent can read a true and clear skill and still do something else. SkillUnit checks the skill
itself.

**Proof** says the skill is what your passing tests declare. **Test** says the skill is clear enough to decide with.

`skillunit check` runs the two and prints each unit of the skill with what each layer found. On [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch), a small HTTP client in this repository, cut to three of its units:

```
Units  proof ran `node ../../tools/tsc.mjs --noEmit && npx vitest run` in 0.9 s, exit 0 · test typesafe · jev-1.14.0
  …
  skill/features/retries.md
    …
    retry-delay  fact
      proof  ✓ proved by a test, src/skill/retries.test.ts:51
      test   –
    what-is-retried  fact
      proof  ✓ proved by a test, src/skill/retries.test.ts:94
      test   ✓ src/skill/retries.test.ts:94  retry-on-429  once 0.99
    …
    retry-idempotent-only  rule
      proof  – declared, no test, src/skill/retries.test.ts:161
      test   ✓ src/skill/retries.test.ts:161  post-no-retry  no-retry 1.00
      test   ✓ src/skill/retries.test.ts:161  patch-no-retry  no-retry 1.00
      test   ✓ src/skill/retries.test.ts:161  put-may-retry  retry 0.98
  …

  24 units · 5 proof and test · 17 proof only · 2 test only · 0 not covered
  24 units · 22 proved by a test · 2 declared without one
  9 tests · 6,372 in / 474 out tokens

OK  proof ok · test 9/9 passed
```

Each `test` line is a question for the decision model, with the option it chose and the probability it gave it. A `–` is a layer with nothing on that unit. `retry-idempotent-only` is advice that no test can prove, so it is declared without one and three questions check it.

What it costs to run:

- **A check takes seconds.** Proof takes as long as the tests that declare the skill, and the decision model answers all the questions about one file in one request.
- **Proof needs no model and no key.** It runs on pull requests from forks, which get no secrets.
- **The questions cost a fraction of a cent.** The run above was about $0.0003: see [what a run costs](https://github.com/Elecash/skillunit/blob/main/docs/ci.md#what-a-run-costs).

## Quick start

SkillUnit is made to be used by your coding agent. Install the package, and the skill that teaches the agent to use it, with [skills.sh](https://skills.sh):

```sh
npm install --save-dev skillunit
npx skills add https://github.com/Elecash/skillunit --skill skillunit
```

Then ask the agent:

```
Add SkillUnit to this project and write a skill for it in skills/my-skill.
Start from the source code: list what an agent that writes code with this library needs
to know and can get wrong, and show me the list before you write any unit.
```

The list is the content of your skill, so read it before the agent goes on. From there it writes each row as a unit in a test that checks it, builds the skill, and adds the questions for what no test can state.

When it is done, check the result yourself:

```sh
npx skillunit check --dry-run   # needs no key: the proof, and the questions without sending them
npx skillunit check             # asks the decision model
```

The second command needs a decision model and its key. SkillUnit has adapters for [TypeSafe](https://typesafe.ai), the default, and [OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions), and takes one of your own: see [Decision models](https://github.com/Elecash/skillunit/blob/main/docs/configuration.md#decision-models).

To set a project up by hand, see [Setting up by hand](https://github.com/Elecash/skillunit/blob/main/docs/index.md#setting-up-by-hand).

## How it works

A skill is written as Vitest tests. `unit()` is a test like any other with a sentence on top, and the sentence goes into the skill when the test passes. A test you already have becomes a unit by giving it that sentence. We recommend test files of their own for the skill instead, one for each file of the skill: the skill then reads in the order you wrote it, and your other tests stay as they are.

Another JavaScript runner works too, and so does another language: see [Another runner](https://github.com/Elecash/skillunit/blob/main/docs/proof.md#another-runner) and [The JSON contract](https://github.com/Elecash/skillunit/blob/main/docs/proof.md#the-json-contract).

### A file, a unit, and the Markdown they become

`setup()` declares a file of the skill, and each `unit()` after it one instruction in that file. From [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch), in `src/skill/retries.test.ts`, with the body cut short:

```ts
setup('retries', {
  file: 'features/retries.md',
  title: 'tinyfetch — retries',
  when: 'Retry a request that failed',
  description: 'Which failed requests tinyfetch sends again, how often, and how long it waits in between.',
});

unit(
  'retry-delay',
  {
    when: `a request with \`${opt('retry')}\` fails and is sent again.`,
    values: { delay: DEFAULT_RETRY_DELAY, times: RETRY_TIMES },
  },
  async (u) => {
    // … a request fails three times, and `waits` times each wait before a new attempt
    // #region skill:retry-delay
    const users = tf.get('https://api.example.com/users', { retry: 3, retryDelay: 1_000 });
    // #endregion
    const set = await waits(users);
    // … the same with the default delay; `times` is how the first wait compares with the delay asked for
    const grows = [byDefault, set].every((w) => w.every((ms, i) => i === 0 || ms === w[i - 1]! * RETRY_TIMES));
    u.value(
      `before the first new attempt tinyfetch waits ${times}\`${opt('retryDelay')}\`, ${times}${DEFAULT_RETRY_DELAY} ms by default, and before each next one ${grows ? `${RETRY_TIMES}x the wait before it` : `a wait that is not ${RETRY_TIMES}x the one before it`}.`,
    );
  },
);
```

The sentence is built from what the body observed, with `u.value()`, so a change to the waits changes the sentence instead of failing an assertion someone would edit. Its numbers come from the constants of the code, and the names of the options from its types: `opt` is `key<RequestOptions>`, which takes only a key of that type. The lines of the region are the example, and the import under the description of the file is a region of the test file too.

`npx skillunit proof --write` runs the tests and writes `skill/features/retries.md`. Here it is with its other units left out:

````md
# tinyfetch — retries

Which failed requests tinyfetch sends again, how often, and how long it waits in between.

```ts
import { tf } from "tinyfetch";
```

## Rules

### fact: retry-delay

When: a request with `retry` fails and is sent again.

Value: before the first new attempt tinyfetch waits `retryDelay`, 300 ms by default, and before each next one 2x the wait before it.

```ts
const users = tf.get("https://api.example.com/users", {
  retry: 3,
  retryDelay: 1_000,
});
```
````

A unit is one of three kinds, by the key that holds its sentence:

- a [**fact**](https://github.com/Elecash/skillunit/blob/main/docs/units.md#a-fact), with `value`: what the code does, for the agent to state or rely on as it is, such as a default;
- a [**rule**](https://github.com/Elecash/skillunit/blob/main/docs/units.md#a-rule), with `do`: what the agent must do, or must not;
- a [**decision**](https://github.com/Elecash/skillunit/blob/main/docs/units.md#a-decision), with `decide`: a choice between paths, each with the condition that selects it.

[A unit in a test](https://github.com/Elecash/skillunit/blob/main/docs/proof.md#a-unit-in-a-test) has every key of a unit, and [Writing the tests of a skill](https://github.com/Elecash/skillunit/blob/main/docs/style-guide.md) says which units to write.

### What no test can state

Some instructions are advice about something outside the code. tinyfetch sends a POST again like any other request, and whether the server can take it twice is not in tinyfetch. Such a unit is declared with no body, and the report calls it declared, never proved. What checks it is a question for a decision model. From the same file, with the strings its helpers build written out:

```ts
unit('retry-idempotent-only', {
  when: 'the code adds `retry` to a request.',
  do: 'pass `retry` only to GET, HEAD, PUT and DELETE, which a server can receive twice with the same result; leave it off POST and PATCH, where a repeated request can create or change something twice.',
  ask: {
    id: 'post-no-retry',
    scenario: 'A payment is sent with `tf.post` to an API that sometimes answers 503.',
    question: 'Should the agent pass `retry` to that call?',
    options: {
      retry: 'Pass `retry` to the `tf.post` call',
      'no-retry': 'Leave `retry` off the `tf.post` call',
    },
    expect: 'no-retry',
  },
});
```

`npx skillunit check` gives the built file and the question to the decision model, which answers with a probability for each option. The question passes when the expected option wins:

```
    retry-idempotent-only  rule
      proof  – declared, no test, src/skill/retries.test.ts:161
      test   ✓ src/skill/retries.test.ts:161  post-no-retry  no-retry 1.00
```

A question is proven by a change that fails it: with its unit saying the opposite, it must fail. A rule made vague is harder to catch, and fails some of its questions, not all: see [Make a rule vague](#make-a-rule-vague). [Questions](https://github.com/Elecash/skillunit/blob/main/docs/questions.md) says when a unit is worth one, and how to write it.

## Try it

[tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch) is a small HTTP client in this repository, and its skill is built from its tests. Clone the repository, build SkillUnit and check it:

```sh
git clone https://github.com/Elecash/skillunit
cd skillunit
npm ci
npx nx build skillunit
cd apps/tinyfetch
npx skillunit check --dry-run
```

`--dry-run` does everything except ask the decision model, so it needs no key. It ends with:

```
OK  proof ok · test dry run ok, 9 tests ready
```

Now break it, one thing at a time. `git checkout .` undoes each change.

### Change a default

In `src/timeout.ts`, change `DEFAULT_TIMEOUT = 10_000` to `5_000` and run `npx skillunit proof`. The tests pass, because the fact is written from the constant. The skill in the repository still says 10 seconds, so proof fails:

```
    default-timeout  fact
      proof  ✓ proved by a test, src/skill/timeouts.test.ts:28
      proof  ✗ skill/features/timeouts.md:15  this line is not what the build gives: the build has `Value: the request waits 5 seconds…`, the skill has `Value: the request waits 10 seconds…`. Run `skillunit proof --write` to update the skill. …
               from the test of `default-timeout`, src/skill/timeouts.test.ts:28

FAILED  proof 1 error, 0 warnings
```

`npx skillunit proof --write` writes the new skill, and proof passes. CI runs the same check, so the pull request that changes the default has to bring the new skill with it.

### Change what the code does

In `src/request.ts`, swap the first two terms of `options.timeout ?? client.timeout ?? DEFAULT_TIMEOUT`, so that the timeout of the client wins over the one of the request. Run `npx skillunit proof`. The test of `timeout-precedence` builds its sentence from the timeouts it observes, so it passes, and the sentence it builds is not the one the skill has:

```
    timeout-precedence  fact
      proof  ✓ proved by a test, src/skill/timeouts.test.ts:60
      proof  ✗ skill/features/timeouts.md:21  this line is not what the build gives: the build has `… that sets one too, waits for the 'timeout' of its client; a request that sets none waits for the 't…`, the skill has `… that sets one too, waits for its own 'timeout'; a request that sets none waits for the 'timeout' of…`. Run `skillunit proof --write` to update the skill. …
               from the test of `timeout-precedence`, src/skill/timeouts.test.ts:60
```

`npx skillunit proof --write` writes what the code does now. With the sentence typed above an assertion, the test would fail instead, and the assertion is what a hurried fix edits, leaving the sentence false.

### Rename an option

In `src/types.ts`, rename the option `retryDelay` to `backoff` and run `npx skillunit proof`. The tests take the names of the options from the types, so the sentence that names this one no longer compiles. tinyfetch's `proof.run` type-checks the tests before it runs them, so proof fails on the run alone, with the compiler's errors:

```
proof.run failed
  proof  ✗ skillunit.yaml:7  `proof.run` (`node ../../tools/tsc.mjs --noEmit && npx vitest run`) exited with 2 and left no record in `tmp/skill-units`: it failed before any test wrote one. Its output:
           src/request.ts(71,13): error TS2339: Property 'retryDelay' does not exist on type 'RequestOptions'.
           …
           src/skill/retries.test.ts(55,68): error TS2345: Argument of type '"retryDelay"' is not assignable to parameter of type 'keyof RequestOptions'.
           …

  nothing built or compared: the run left no record
```

Vitest runs the tests with their types stripped, so without the type-check in `proof.run` this rename passes. Start yours with it too.

### Edit the skill by hand

In `skill/features/retries.md`, change "300 ms" to "500 ms" and run `npx skillunit proof`:

```
    retry-delay  fact
      proof  ✓ proved by a test, src/skill/retries.test.ts:51
      proof  ✗ skill/features/retries.md:21  this line is not what the build gives: … To change this text, change where it comes from: the skill folder is built.
               from the test of `retry-delay`, src/skill/retries.test.ts:51
```

The `skill` folder is an output. The text of a unit changes in its test, and the error says which test that is.

### Make a rule vague

This one asks the decision model, so it needs a key (see [Quick start](#quick-start)). In `src/skill/retries.test.ts`, replace the `do` of `retry-idempotent-only` with:

```ts
do: `think about whether \`${opt('retry')}\` suits the method before you add it.`,
```

Run `npx skillunit proof --write` to build the skill, then `npx skillunit test`. The rule no longer says which methods a server can receive twice, and the model cannot tell that a PUT may be sent again:

```
    retry-idempotent-only  rule
      test   ✗ src/skill/retries.test.ts:161  put-may-retry  none 0.58
               scenario:  A settings document is replaced with `tf.put`, and the API sometimes answers 503.
               question:  Should the agent pass `retry` to that call?
               expected:  retry
               …
```

The probabilities change a little from one run to the next: the question about a PATCH passes in some runs and fails in others.

## Docs

- [Writing the tests of a skill](https://github.com/Elecash/skillunit/blob/main/docs/style-guide.md): which units to write, what their bodies check, and when a unit gets a question
- [Questions](https://github.com/Elecash/skillunit/blob/main/docs/questions.md): where the questions for the decision model go, how to write one, and the change to its unit that proves it
- [The kinds of unit](https://github.com/Elecash/skillunit/blob/main/docs/units.md): a fact, a rule and a decision, each with a test that declares one and the Markdown it becomes
- [Proof](https://github.com/Elecash/skillunit/blob/main/docs/proof.md): files and units declared in tests, names from the code, which tests `proof.run` runs
- [Configuration](https://github.com/Elecash/skillunit/blob/main/docs/configuration.md): `skillunit.yaml`, the key, decision models
- [Command line](https://github.com/Elecash/skillunit/blob/main/docs/cli.md): commands, options, reporters, exit codes
- [CI](https://github.com/Elecash/skillunit/blob/main/docs/ci.md): the workflow, pull requests from forks, what a run costs

## License

[MIT](https://github.com/Elecash/skillunit/blob/main/LICENSE) © Raúl Jiménez
