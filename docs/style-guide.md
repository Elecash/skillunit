# Writing the tests of a skill

A skill that SkillUnit builds comes from tests. Each file of the skill is declared with
`setup()`, each instruction with `unit()`, and each question for the decision model with `ask`.
This guide says what to put in those tests: which units to write, what their bodies check, when
a unit has no body, and when it gets a question. [Proof](proof.md) has the API, and
[Questions](questions.md) has the format of a question.

Each rule here came from writing two skills again from nothing, tinyfetch's and SkillUnit's own.
When a rule says what went wrong without it, that is where it was found.

## The list comes from the code

Before any unit, read the source of the code and list what an agent that writes code with it
needs to know and can get wrong. Each row of the list becomes a unit, or is left out with a
reason: "an agent runs `--help` itself", "the types document it".

Do not start from a skill or a README that is already there. A unit copied from old text says
what the old text said. tinyfetch's old skill said "`baseUrl` is the prefix of every path", and
its test passed, because it tried the one form of slashes that works: with `new URL(path, base)`,
`https://api.example.com/v1` and `/users` give `https://api.example.com/users`.

**Every public name is in a unit or left out on purpose:** exports, methods, options, settings,
commands. Where the code can list them, the sentence is built from the list, so a name added to
the code changes the skill:

- the runtime has the values a module exports: `Object.keys(module)`;
- the compiler has the types too: `exportNames()` from `skillunit/typescript`;
- only the type has the keys of an options type: an object typed against the type does it.

```ts
// A key added to `ClientOptions` fails the type-check of this test until it is described here.
const does: Record<keyof ClientOptions, string> = {
  baseUrl: 'goes before every path that is not a whole URL',
  headers: 'are sent with every request of the client',
  timeout: "is the timeout of a request that sets none of its own",
};
u.value(Object.entries(does).map(([key, what]) => `\`${key}\` ${what}.`).join(' '));
```

## A file of the skill

- **One test file per file of the skill**, with its `setup()` first and its units after it, in
  the order the file shows them. Each unit belongs to the last `setup()` before it in its test
  file, so a second `setup()` in a file takes every unit after it.
- **Name the test files so `proof.run` runs them alone**, such as `*.skill.test.ts` with
  `npx vitest run skill.test`. Every command runs them, and the whole suite is slower.
- **`SKILL.md` is the index.** Its `setup()` has the `frontmatter` and no `when`. The `when` of
  every other file is its row in the table of `SKILL.md`: the task that sends an agent to it.
- **Small files, one task each.** An agent reads only what its task needs, and the decision
  model reads one file per request. When an agent doing one task needs half a file, the file is
  two. When it needs five files for one task, they are one.

## A unit and its body

A unit has a body that asserts what its sentence says. `do` makes a rule, `value` a fact, and
`decide` with `paths` a decision; [Proof](proof.md#a-unit-in-a-test) has every key.

```ts
unit(
  'retry-delay',
  {
    when: `a request with \`${opt('retry')}\` fails and is sent again.`,
    value: `before the first new attempt tinyfetch waits \`${opt('retryDelay')}\`, ${DEFAULT_RETRY_DELAY} ms by default, and before each next one ${RETRY_TIMES}x the wait before it.`,
    values: { delay: DEFAULT_RETRY_DELAY, times: RETRY_TIMES },
  },
  async () => {
    vi.useFakeTimers();
    serve({ status: 503 }, { status: 503 }, { body: 'ok' });
    const pending = tf.get(API, { retry: 2 });
    await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_DELAY);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_DELAY * RETRY_TIMES);
    expect(calls).toHaveLength(3);
    expect(await pending).toBe('ok');
  },
);
```

**A sentence says no more than its body checks.** "Every", "any", "always" and "never" need a
body that goes through every case, or a sentence that names the cases the body tried. The body
of tinyfetch's `base-url` now tries the four forms: a base with and without `/` at its end, and
a path with and without `/` at its start.

**A sentence about what the code does is built from what the body observed**, with
`u.value()`. A sentence typed in `value` above an assertion is the weak form. When the behaviour
changes, the test goes red, someone edits the assertion to match, and the sentence stays: the
tests, the type-check and the proof all pass, and the skill is false. In a round of trials, 7 of
12 changes that left a skill wrong ended with everything green, and in each the false text was
typed in a test.

tinyfetch's `timeout-precedence` was the weak form:

```ts
unit(
  'timeout-precedence',
  {
    when: `a client or a request sets \`${opt('timeout')}\`.`,
    value: `a request's own \`${opt('timeout')}\` wins over the \`${key<ClientOptions>('timeout')}\` of its client, and the client's over the default.`,
  },
  async () => {
    // … three requests that time out …
    expect(await outcomes([…])).toEqual([DEFAULT_TIMEOUT / 4, DEFAULT_TIMEOUT / 2, DEFAULT_TIMEOUT]);
  },
);
```

With the client's `timeout` made to win, the test failed, and the fix that made it pass changed
`DEFAULT_TIMEOUT / 2` to `DEFAULT_TIMEOUT / 4` and left the sentence. Built from the observation,
there is no expected value to edit:

```ts
async (u) => {
  // … three requests that time out: one that sets `timeout` on a client that sets one, one that
  // sets none, and one on a client that sets none either …
  const [both, client, neither] = (await Promise.all(pending)).map((e) => (e as TimeoutError).timeout);
  const source = (ms) => ({ [ofRequest]: 'its own `timeout`', [ofClient]: 'the `timeout` of its client', [DEFAULT_TIMEOUT]: 'the default' })[ms];
  expect([both, client, neither].every((ms) => [ofRequest, ofClient, DEFAULT_TIMEOUT].includes(ms))).toBe(true);
  u.value(`a request that sets \`timeout\`, on a client that sets one too, waits for ${source(both)}; …`);
},
```

The body asserts only what holds whatever the code does: each request timed out after one of the
three times. The same change now passes the tests, and the proof fails on the built line, with
the test it comes from. `skillunit proof --write` writes "…waits for the `timeout` of its
client", which is what the code does.

It does not reach the words around the observed value: "waits for" and "on a client that sets
one too" are typed. Where no value can carry a claim, put what the body saw in the sentence or in
an example, so the skill at least shows what happened. tinyfetch's `what-is-retried` lists in an
example the statuses of a case that are not all retried alike, and `base-url` lists the URLs it
sent when they are not the one it expects. A number the body observes must still be in `values`,
so a sentence names the setting that won, in words, rather than the number it gave.

**An example is a region with code of the library only.** The lines between `#region
skill:<id>` and `#endregion` are copied into the skill as they are. Set up the fake server
before the region, and assert after it:

```ts
serve({ body: { name: 'Ada' } });
// #region skill:await-every-request
const user = await tf.get<{ name: string }>('https://api.example.com/users/1');
console.log(user.name);
// #endregion
expect(log).toHaveBeenCalledWith('Ada');
```

**A block that is not code of the tests comes from the body**, with `u.example(lang, text)`: a
shell command, a JSON config, an output. Build it from values of the code, and assert on them:

```ts
unit('install-the-server', { when: 'the server is not installed.', do: 'run it with `npx`.' }, (u) => {
  const config = { servers: { example: { command: 'npx', args: ['-y', pkg.name] } } };
  expect(pkg.bin).toBeDefined(); // `npx` can run the package
  u.example('bash', `npx -y ${pkg.name}`);
  u.example('json', JSON.stringify(config, null, 2));
});
```

`u.example()` is no assertion. A body that only calls it builds its unit, and the report counts
the unit as declared, not proved.

## No value or name typed twice

**A value.** Every value that defines behaviour has a name in the code: a constant, a property, a
member of an enum. The code uses the name, the assertion uses it, and the sentence is built from
it and lists it in `values`. When the code has the value only as a literal, give it a name before
writing the unit.

tinyfetch's skill once said the wait between retries is "doubled". The code had
`retryDelay * 2 ** n`, the test asserted `2 * DEFAULT_RETRY_DELAY`, and the sentence had the
word: one value, written three times by hand. When the code went to `3 ** n`, the test went red,
someone edited the assertion, and `check` passed with "doubled" still in the skill. With
`RETRY_TIMES` in all three, changing it changes the sentence, and the proof fails until
`skillunit proof --write`.

`unit()` checks the part a tool can see: a number in the text of a unit with a body must be one
of its `values` ([the number rule](proof.md#no-value-typed-twice)). A word such as "doubled" it
cannot see.

**A name.** Where a sentence names something of the code (an option, a method, an export, an
error, a type), the name comes from the code:

| The name of | From | Such as |
| --- | --- | --- |
| a key of a type: an option, a method, a field | `key<T>(name)`, which takes only a key of `T` | `` `${key<RequestOptions>('retry')}` `` |
| a value a module exports, named one by one | `key<typeof module>(name)`, which takes only a name the module exports | `` `${key<typeof Tinyfetch>('create')}` `` |
| the values a module exports | `Object.keys(module)`, or `exportNames()` | the list of exports |
| a type a file exports | `exportNames()` from `skillunit/typescript` | `Client`, `RequestOptions` |
| a class or a function | its `name` | `` `${HttpError.name}` `` |

A function's `name` is the name its code gave it, which is not always the name a module exports
it under. `export const merge = createMerge()` exports a function whose `name` is another one, or
empty. For such an export, take the name of the export: `key<typeof module>('merge')` accepts only
a name the module exports.

`module` is the type of the library's entry, imported with `import type * as Tinyfetch from
'tinyfetch'`. tinyfetch's tests name an export with `exported = key<typeof Tinyfetch>`, so a
renamed export fails the type-check at every sentence that names it. To list names in a
sentence, `and()`, `or()` and `code()` from `skillunit/vitest` join them as a sentence does:
`and(code(['retry', 'timeout']))` gives `` `retry` and `timeout` ``.

**The text of a `setup()`** follows the same rule: the description of a file, the `when` of its row
in the index, and the description of the frontmatter. The build compares them with nothing but
the number rule. With `query` removed from tinyfetch's code and from the unit that stated it, the
row of the index still said "…headers and query", and everything passed. The row is now built
from the type:

```ts
const opt = key<RequestOptions>;

setup('requests', {
  file: 'features/requests.md',
  title: 'tinyfetch — requests',
  when: `Send a request: its method, path, body, ${and([opt('headers'), opt('query')])}`,
  description: 'What a request sends, and what its call resolves to.',
});
```

Declare the helpers it uses before the `setup()`: it runs when the test file loads.

With `retryDelay` renamed to `backoff` in tinyfetch's code and in the keys of its tests, as an
IDE renames it, the tests passed, and after `proof --write` the skill listed `backoff` among the
options and still said "waits `retryDelay`". With the name from `key<RequestOptions>()`, the
rename fails the type-check of the test at that sentence. A test run that strips the types, as
Vitest does, does not check them, so put the type-check first in `proof.run`, as
`npx tsc --noEmit && npx vitest run skill.test`: the proof then fails on the rename, with the
compiler's error.

The name of a parameter stays typed, as in "pass the value itself as `body`": arguments go by
position, so renaming a parameter changes nothing an agent writes.

## The change that proves a unit

A unit is done when a change to the code that makes its sentence false turns something red with
no test edited. For each unit, make the smallest such change, run the tests and
`skillunit check --dry-run`, and write down what went red. Then run `skillunit proof --write`,
write down whether the skill is true, and undo the change. A unit where nothing goes red is not
done.

| Unit | Change | What went red | After `proof --write` |
| --- | --- | --- | --- |
| `retry-delay` | the first new attempt waits the second wait | the text of `retry-delay` | true: "waits 2x `retryDelay`" |
| `headers` | the client's headers win over the request's | the text of `headers` | true: "…then its own, then the `headers` of its client" |
| `send-a-body` | a string body is sent as it is | the test of `send-a-body` | still red: a rule, whose test is edited by hand |

The last column tells the two kinds of red apart. A red test is fixed by editing the test, and a
hurried edit of the assertion leaves the sentence false. A red text is fixed by `--write`, which
writes what the code does now. On tinyfetch, 23 of 28 such changes end with a true skill after
`--write`. Of the 5 left, 4 fail the test of a rule, whose body checks the fact the advice rests
on, and 1 adds a key to `RequestOptions`, which fails the type-check on purpose.

The table finds what review misses. In SkillUnit's own skill, two bodies passed and proved
nothing until their change turned nothing red: one tried a tie under the threshold, which fails
anyway, and one could not tell whether `tsconfig.json` was read. It also catches
`expect(true).toBe(true)`, which the count of assertions takes for a real one.

## A unit with no body: a gap and its reason

A unit with no body is something an agent needs and no test of this code can state: what a server
does with a repeated request, how long an upload may take, which of two designs to choose. Say
why in a comment above it. Where part of it can be tested, that part is a unit with a body, and
the advice stands on it:

```ts
// A gap: whether the server can take a request twice is not in tinyfetch; `retry-any-method`
// is the part a test states, and this advice stands on it.
unit('retry-idempotent-only', {
  when: `the code adds \`${opt('retry')}\` to a request.`,
  do: 'pass `retry` only to GET, HEAD, PUT and DELETE; leave it off POST and PATCH.',
  evenWhen: 'the network drops now and then; tinyfetch sends a POST again like any other request.',
  ask: { /* … */ },
});
```

A gap is for what cannot be tested, not for what is slow to test. A body that needs a fake
server the project does not have yet is a body to write.

## When a unit gets a question

A question is for a rule or a decision where an agent would plausibly choose wrong, and its wrong
options are the answers an agent gives without the unit. A unit with a test gets a question only
when its sentence leaves the reader something to work out: two values to combine, an exception to
apply. A fact that states one value from the code gets none.

**The scenario pulls toward the wrong answer.** The user asks for what the rule forbids, or the
shortcut is in plain sight. A plain scenario lets common sense pass the question. tinyfetch's
`long-upload` needed its unit only once the user in the scenario asked for no time limit.

**Do not ask the reader to add up**, or to conclude from a list that what it leaves out does not
exist. Asked for the total of three waits that grow, the reader multiplied. Shown "these options
and no other", it would not say there is no connect timeout. What the skill must say is absent,
a fact says in so many words, in `unknown`.

## The change that proves a question

A question is proven like a unit, by a change that fails it. Write the opposite in the sentence
of its unit, ask the question, and it must fail; then undo the change. The question is there for
the day the skill says something else, and that is the change it has to notice.

```sh
cp -R skills/my-skill /tmp/my-skill-copy
# in the copy, write the opposite in the sentence of the unit, and keep its heading and `When`
npx skillunit test --skill /tmp/my-skill-copy --no-run
```

Do it for every unit that has questions, on the model CI asks. A verdict within the margin of its
threshold can flip from one run to the next, so only a clear failure counts. A question that
still passes with its unit saying the opposite does not read the unit: change the question, never
a threshold.

Deleting the unit's text instead is a reading, not a test. It says whether the model answers
right without the skill. For an API the model knows, it does, and that is the normal case: the
question stays. Measured on 2026-11-26 on 27 questions of three skills, on both models: all 54
verdicts passed with their unit, 10 passed with its text deleted, and none passed with the unit
saying the opposite, those 10 included.

[Questions](questions.md#proving-a-question) says where to look when a question passes with its
unit saying the opposite.

## What the build writes

The build lays out each file the same way, and nothing in it is written by hand:

```
---                                (SKILL.md only: the frontmatter of its setup())
# <title>
<description>
<the region skill:<setup id>, if there is one>
## Where to look                   (SKILL.md only: a row per other file, from its `when`)
## Rules
### <kind>: <id>                   (each unit, in the order its test file declares it)
When: … · Do: … / Value: … / Decide: … · Even when: … · Unknown: …
```

Each label is a paragraph of its own. A rule's examples go under `Right:`, a fact's under its
`Value`, and a decision's under the path their region names. To change a line, change the test it
comes from and run `skillunit proof --write`: an edit by hand to the skill folder fails the next
proof.
