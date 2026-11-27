# The kinds of unit

A unit is one instruction of the skill. It is a fact, a rule or a decision, and the key that holds its sentence says which: `value` makes a fact, `do` a rule, and `decide` with `paths` a decision. A spec with two of them is refused. Every kind has `when`: the situation the agent is in when the unit applies.

| Kind | Use it for | Its sentence | The agent reads |
| --- | --- | --- | --- |
| [Fact](#a-fact) | what the code does, for the agent to state or rely on as it is | `value`, or `u.value()` in a body that goes through a list of cases | `When`, `Value`, `Unknown` |
| [Rule](#a-rule) | what the agent must do, or must not | `do` | `When`, `Do`, `Even when`, `Right` |
| [Decision](#a-decision) | a choice between ways that are all right somewhere | `decide`, and a `when` for each of `paths` | `When`, `Decide`, one item per path, `Even when` |

The examples are from [tinyfetch](https://github.com/Elecash/skillunit/tree/main/apps/tinyfetch) and from SkillUnit's own skill, with their bodies cut short. [A unit in a test](proof.md#a-unit-in-a-test) has every key of a spec, and [Writing the tests of a skill](style-guide.md) says how to write a unit that stays true.

## A fact

A fact says what the code does: a default, what a call resolves to, what a failed request throws. Most units of a skill that describes code are facts, since a test can state them.

```ts
unit(
  'retry-delay',
  {
    when: `a request with \`${opt('retry')}\` fails and is sent again.`,
    value: `before the first new attempt tinyfetch waits \`${opt('retryDelay')}\`, ${DEFAULT_RETRY_DELAY} ms by default, and before each next one ${RETRY_TIMES}x the wait before it.`,
    values: { delay: DEFAULT_RETRY_DELAY, times: RETRY_TIMES },
  },
  async () => {
    // … a request fails three times, and the test checks how long each wait is
    // #region skill:retry-delay
    const users = tf.get('https://api.example.com/users', { retry: 3, retryDelay: 1_000 });
    // #endregion
    await waits(users, 1_000);
  },
);
```

````md
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

- `value` is the sentence, and the body asserts what it says: a change to the waits turns this test red. A body that goes through a list of cases sets the sentence instead, with `u.value(text)`: tinyfetch's `what-is-retried` tries each kind of failure and writes which ones were sent again.
- `values` names each number the sentence states. A number that is not there fails the test; see [No value typed twice](proof.md#no-value-typed-twice).
- `unknown` says, in so many words, what is not there: an option the library does not have, a case the fact does not cover. It becomes the `Unknown` label.
- The example is the region of the body, and goes under the value.

## A rule

A rule tells the agent what to do, or what not to do. Use it where the code allows the wrong thing and the agent has to choose the right one.

```ts
import { code, or, unit } from 'skillunit/vitest';

unit(
  'send-a-body',
  {
    when: `the code sends data with ${or(code(withBody))}.`,
    do: `pass the value itself as \`body\`, not \`JSON.stringify(value)\`: tinyfetch sends \`JSON.stringify(body)\`, so a string is sent as a quoted JSON string.`,
  },
  async () => {
    serve({ body: {} });
    // #region skill:send-a-body
    await tf.post('https://api.example.com/users', { name: 'Ada' });
    // #endregion
    expect(calls[0]!.init.body).toBe(JSON.stringify({ name: 'Ada' }));
    // … and the same for `put` and `patch`, with a string too
  },
);
```

````md
### rule: send-a-body

When: the code sends data with `post`, `put` or `patch`.

Do: pass the value itself as `body`, not `JSON.stringify(value)`: tinyfetch sends `JSON.stringify(body)`, so a string is sent as a quoted JSON string.

Right:

```ts
await tf.post("https://api.example.com/users", { name: "Ada" });
```
````

- `do` is the sentence. Say why in it: the body of this rule checks the reason, that a string is sent quoted.
- `evenWhen` names the situation where the agent is tempted to break the rule, such as "the user asks for the request to wait as long as it needs". It becomes the `Even when` label.
- The example is the region of the body, and goes under `Right`.
- A rule about something outside the code has no body, since no test can check it: see [A unit no test proves](proof.md#a-unit-no-test-proves).

## A decision

A decision is a choice between ways that are each right in some situation. `decide` names the choice, and each of `paths` has a `path`, its short name, and a `when`, the condition that selects it.

```ts
import { and, code, unit } from 'skillunit/vitest';

unit(
  'which-entry',
  {
    when: 'a project declares the units of its skill in its tests.',
    decide: 'where `unit()` comes from.',
    paths: [
      { path: 'vitest', when: `the tests run on Vitest: import ${and(code(vitestNames))} from \`${VITEST}\`.` },
      { path: 'other-runner', when: `another JavaScript runner: \`${createUnit.name}(it)\` from \`${UNIT}\` gives \`${unit.name}\`, \`${ask.name}\` and \`${setup.name}\` for that runner's \`it\`.` },
      { path: 'other-language', when: `another language: each test writes its record itself, one JSON file per unit in \`proof.units\`, in version ${UNIT_CONTRACT} of the contract, whose types \`${UNIT}\` exports.` },
    ],
    values: { contract: UNIT_CONTRACT },
  },
  async () => {
    // … the package has the two entry points, and a record written by hand builds
  },
);
```

```md
### decision: which-entry

When: a project declares the units of its skill in its tests.

Decide: where `unit()` comes from.

- **vitest** — the tests run on Vitest: import `and`, `ask`, `code`, `key`, `or`, `setup` and `unit` from `skillunit/vitest`.

- **other-runner** — another JavaScript runner: `createUnit(it)` from `skillunit/unit` gives `unit`, `ask` and `setup` for that runner's `it`.

- **other-language** — another language: each test writes its record itself, one JSON file per unit in `proof.units`, in version 2 of the contract, whose types `skillunit/unit` exports.
```

- The example of a path is the region `skill:<id>.<path>`, such as `skill:which-entry.vitest`, and goes under its item.
- `u.example()` is refused in a decision: its examples belong to its paths.
- `evenWhen` works as in a rule.

## Which kind

- The sentence says what the code does: a **fact**.
- The sentence tells the agent what to do: a **rule**.
- There is more than one right way, and the situation selects it: a **decision**.

When a rule only repeats a fact as an order ("the default is 10 seconds" and "use 10 seconds"), keep the fact. The agent reads the fact and acts on it.
