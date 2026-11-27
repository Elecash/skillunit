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

**A sentence can be built from what the body observes.** Which statuses are retried, what each
method resolves to: the body tries each case and builds the sentence with `u.value()`, so a
change to the code changes the sentence. The proof then fails on the difference, and someone
reads it in the pull request.

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
| a value a module exports | `Object.keys(module)`, or `exportNames()` | the list of exports |
| a type a file exports | `exportNames()` from `skillunit/typescript` | `Client`, `RequestOptions` |
| a class or a function | its `name` | `` `${HttpError.name}` `` |

A function's `name` is the name its code gave it, which is not always the name a module exports
it under. `export const defu = createDefu()` exports a function whose `name` is another one, or
empty. For such an export, take the name of the export: `key<typeof module>('defu')` accepts only
a name the module exports.

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
`skillunit check --dry-run`, write down what went red, and undo the change. A unit where nothing
goes red is not done.

| Unit | Change | What went red |
| --- | --- | --- |
| `retry-delay` | the first new attempt waits the second wait | the test of `retry-delay` |
| `headers` | the client's headers win over the request's | the test of `headers` |
| `exports` | one name more exported | the text of `exports`, in the proof |

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
shortcut is in plain sight. A plain scenario lets common sense pass the question, and then it
passes without its unit too. tinyfetch's `long-upload` needed its unit only once the user in the
scenario asked for no time limit.

**Do not ask the reader to add up**, or to conclude from a list that what it leaves out does not
exist. Asked for the total of three waits that grow, the reader multiplied. Shown "these options
and no other", it would not say there is no connect timeout. What the skill must say is absent,
a fact says in so many words, in `unknown`.

## The copy check

A question passes with its unit and fails without it. To tell, copy the skill folder, delete the
text of the unit in the copy and keep its heading, and ask the questions about the copy:

```sh
npx skillunit test --skill /tmp/my-skill-copy --no-run
```

Do it for every unit that has questions, on the model CI asks. A verdict within the margin of its
threshold can flip from one run to the next, so only a clear failure without the unit counts.

A question that passes without its unit goes, or the unit changes; never a threshold. When the
unit's text changes so that a question passes, note what the agent now reads that it did not.
When the question was the only reason for a unit with no body, the unit goes with it: the rest of
the skill, or common sense, already gives the agent that advice.

On SkillUnit's own skill, the copy check took three gaps out. Two had questions that passed
without them, since other units already said the same; the third had one that failed even with
its unit, and its advice was in another unit too. [Questions](questions.md#checking-that-a-question-is-real)
says where to look when a question stays green.

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
