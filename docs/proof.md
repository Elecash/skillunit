# Proof

Lint checks that the examples of a skill compile, and does not read what a sentence says. A
skill can pass it and still say the default timeout is 10 seconds after the code changed it to 5.
Proof closes that gap by moving the sentence next to the code that makes it true: a unit that a
test can prove is declared in that test, and the skill is built from the tests and a source
folder people write.

```ts
import { unit } from 'skillunit/vitest';

unit(
  'default-timeout',
  {
    when: 'the user asks how long a request waits by default.',
    value: `${DEFAULT_TIMEOUT / 1000} seconds (\`timeout: ${DEFAULT_TIMEOUT}\`), for every method.`,
  },
  async () => {
    // the test: its setup, what it does, its assertions
  },
);
```

The `Value` is built from `DEFAULT_TIMEOUT`. When someone changes the constant, the test still
passes, the built skill says 5 seconds, and `skillunit check` fails until the skill in the
repository says so too. The difference shows up in the same pull request as the change.

## A unit in a test

`unit(id, spec, body)` registers a test with the runner's own `it`, so loops, `describe`,
`beforeEach` and the project's mocks work as in any test. `unit.skip` and `unit.only` go to the
runner's `it.skip` and `it.only`, and anything after the body, such as a timeout, goes to `it`.

The keys of the spec give the kind of the unit and its labels:

| Key | For | Becomes |
| --- | --- | --- |
| `when` | every kind, required | `When:` |
| `do` | a rule | `Do:` |
| `value` | a fact; the body may set it instead | `Value:` |
| `decide`, `paths: [{ path, when }]` | a decision | `Decide:` and one `- **path** — when` item per path |
| `unknown` | a fact | `Unknown:` |
| `evenWhen` | a rule or a decision | `Even when:` |
| `check` | any kind | `Check:` |
| `values: { name: value }` | any kind | values the prose of the skill uses, as `{{value:<id>.<name>}}`: text on one line, a finite number or a boolean. A name is letters, digits and hyphens: `max-parts`, not `max_parts` |
| `examples: [{ lang, text }]` | a rule or a fact | blocks shown under `Right`, or under the `Value`; `lang` is a fence language: letters, digits, `_`, `+`, `.` and `-` |
| `ask` | any kind | the [questions](questions.md) for the decision model about the unit |

`do` makes a rule, `value` a fact, `decide` or `paths` a decision. A spec with two of them, an id
that is not kebab-case, a key the kind does not take, or a question with a mistake fails its test
with a message that says what to fix.

The body gets a context, and the runner's own context after it:

- `u.value(text)` sets the `Value` of a fact from what the body observed;
- `u.example(lang, text)` adds a block the body produced: an output, a config, a table of
  outcomes.

```ts
unit('what-is-retried', { when: 'a request with `retry` fails.', values: { 'retried-status': RETRIED_STATUS } }, async (u) => {
  const retried: string[] = [];
  const never: string[] = [];
  for (const [name, reply] of cases) {
    serve(reply, { body: 'ok' });
    await tf.get('http://x/a', { retry: 1, retryDelay: 1, timeout: 10 }).catch(() => undefined);
    (calls.length > 1 ? retried : never).push(name);
  }
  u.value(`${and(retried)} are retried; ${and(never)} never are.`);
});
```

Example code comes from the body's own lines, between a line containing `#region skill:<id>` and
the next line containing `#endregion`, with the indentation they share removed. SkillUnit reads
the regions of the test file each record names, with no setting; `proof.sources` adds globs of
other files that hold regions and declare no unit. The markers are
comments in the test's language, and the fence of the block takes the language of the test
file. For a decision, the example of a path is the region `skill:<id>.<path>`. A unit shows its
regions first, in the order of the test files, then the blocks of `examples`, then those of
`u.example`, in the order of the calls. A rule's blocks go under `Right`, a fact's under its
`Value`.

```ts
unit(
  'check-with-is-http-error',
  { when: 'code catches an error from a tinyfetch call and reads its status.', do: 'test the error with `isHttpError(error)` before reading `status` or `body`.' },
  async () => {
    serve({ status: 404 });
    // #region skill:check-with-is-http-error
    try {
      await tf.get('https://api.example.com/users/1');
    } catch (error) {
      if (isHttpError(error) && error.status === 404) console.log('no such user');
      else throw error;
    }
    // #endregion
    expect(log).toHaveBeenCalledWith('no such user');
  },
);
```

When the body passes, the helper writes the unit as JSON into the `proof.units` folder of the
nearest `skillunit.yaml` above the working directory. When it throws, the helper writes a record
with the id and the error's message, and throws again. A skipped test writes nothing.

A body that returns having made no assertion fails as well, with a record that says so:

```text
unit `response-body`: the body made no assertion, so no test proves this unit. Assert in the body
what the unit says, or declare it with no body: `unit(id, spec)` is a unit no test proves
```

`skillunit/vitest` counts the assertions of Vitest's `expect`, `expect.soft` included, and of
the `expect` of the test context when the body uses it, from the start of the body to its end:
an assertion in a `beforeEach` does not count. A body that calls `u.value()` or `u.example()`
passes with no assertion, since it builds the unit from what it observed, and a change shows in
the built skill.

`skillunit/vitest` binds Vitest's `it`. For another runner, `skillunit/unit` exports
`createUnit(it, options)`, which gives `unit` and `ask`. `options.write(record, key)` replaces
the function that writes the file, for a runner that cannot write files itself, such as one in a
browser. `options.assertions(ctx)` returns how many assertions the test has made so far; with
it, a body that made none fails, as with `skillunit/vitest`. Without it nothing is counted, so a
project that asserts with `node:assert` under Vitest, which Vitest does not count, makes its own
helper with `createUnit(it)` and no `assertions`.

```ts
import { it } from 'node:test';
import { createUnit } from 'skillunit/unit';

export const { unit, ask } = createUnit(it);
```

### No value typed twice

- Every value that defines behaviour has a name in the code: a constant, a property, a member of
  an enum.
- The code uses that name, the assertion of the test uses it, and the sentence of the unit is
  built from it.
- A unit with a test has no number typed into its sentence, and no word that stands for one,
  such as "doubled", "twice" or "half".
- When the code has the value only as a literal, give it a name in the code before writing the
  unit.

`unit()` checks the part of this a tool can see. In a unit with a body, every number in `when`,
`do`, `value`, `decide`, `evenWhen`, `unknown`, the `when` of each path, and the `Value` the body
sets with `u.value()`, must be one of the unit's `values`: a value that is that number, or text
that has it as a number of its own. A number is digits, with `_` groups and a decimal part, not
right after a letter, a digit, `_` or `.`, so `300 ms`, `10_000`, `2x` and `5xx` have one and
`utf8` and `sha256` do not; `10_000` and `10000` are the same number. Any other number fails the
test of the unit, which leaves a failed record:

```text
unit `retry-defaults`: the number 2 in `Value` is none of the unit's `values`. Give the value a
name in the code, build the sentence from that name, and list it in `values`
```

There is no exception for a URL, a version, a port or a date: each would let a number of the code
through. A number that is meant, such as the one in a host name, costs one line and is on record
as meant:

```ts
const SITE = '500miles.com';
unit('report-site', { when: 'the code sends a report.', do: `send it to \`${SITE}\`.`, values: { site: SITE } }, () => {
  expect(reportUrl()).toContain(SITE);
});
```

A unit with no body is not checked: advice may give a number the code does not have. SkillUnit
holds a record written by a test in another language to the same check when it reads it.

## A unit no test proves

Advice, and a claim about something outside the library, have nothing to assert. They are
declared with the same `unit()` and no body:

```ts
unit('never-disable-timeout', {
  when: 'a request may take long, such as an upload or a report.',
  do: 'raise `timeout` to a number of milliseconds that fits the request, and never set it to `0`.',
  check: 'forbid `/timeout:\\s*0\\b/` in ts',
  ask: {
    scenario: 'The code uploads a file that can take two minutes.',
    question: 'What does the agent do about the timeout?',
    options: { raise: `Set \`timeout\` above ${DEFAULT_TIMEOUT}`, off: 'Set `timeout: 0`' },
    expect: 'raise',
  },
});
```

It still registers a test with the runner, so `skip`, `only` and a loop work as for any unit,
and its record says it has no body. A fact with no body gives its `value` in the spec. Its
examples come from a `#region skill:<id>` anywhere in the file that declares it, which the type
check of the tests covers, or from `examples` for a block in another language, such as a shell
command:

```ts
unit('init-first', {
  when: 'a project has a skill but no `skillunit.yaml`.',
  do: 'run `npx skillunit init <skill folder>` from the project root.',
  examples: [{ lang: 'sh', text: 'npx skillunit init skills/my-skill' }],
});
```

The report never calls such a unit proved. Under each unit, proof shows
`proved by a test, src/tinyfetch.test.ts:84` or `declared, no test, src/tinyfetch.skill.test.ts:120`,
and its summary counts both: `12 units · 9 proved by a test · 3 declared without one`.

## The source and its slots

`source` in `skillunit.yaml` is the folder people write. `skill` is the folder agents read, and
`skillunit proof --write` builds it. Both are committed.

The source has the same files as the skill. A Markdown file holds the prose, the reference tables
and the examples that belong to no unit, and:

- `{{unit:<id>}}`, alone on a line, where a unit goes;
- `{{value:<id>.<name>}}`, anywhere, a fenced block included, a value of a unit.

Every unit is declared in code. A unit heading in the source, such as `### rule: …`, is an
error: "units are declared with `unit()`; put `{{unit:<id>}}` here".

````md
## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `timeout` | number (ms) | `{{value:default-timeout.ms}}` | abort the request after this long |

## Rules

{{unit:default-timeout}}

{{unit:never-disable-timeout}}
````

Every other file is copied as it is. The prefixes `unit:` and `value:` are there so that a skill
about a template language can show `{{ user.name }}`.

## Building and checking

`skillunit proof`, and `skillunit check`:

1. empty the `proof.units` folder of its records;
2. run `proof.run` through the shell, from the folder of `skillunit.yaml`, and go on whatever it
   exits with, so a failing test is reported on the unit it declares;
3. read the units, fill the source, and run `proof.format` once on the built Markdown files;
4. compare the result with the `skill` folder, and fail on each block of lines that differs.
   A block is reported on its first line that differs in more than layout, so a table whose
   columns the formatter padded again is reported on the row whose value changed.

`skillunit proof --write` writes the `skill` folder instead of comparing. `--no-run` skips steps
1 and 2 and uses the units that are there, for a pipeline that ran the tests in an earlier step.
Without `proof.run`, the units in the folder are used, as with `--no-run`.

It is an error when:

- a `{{unit:…}}` has no unit. The message says why when it can: the message of the failed test,
  or that no test left it, because it was skipped or deleted or the tests did not run;
- a `{{value:…}}` has no value;
- a test declares a unit and no file of the source has its slot;
- two tests declare the same id;
- the source has a unit heading;
- a slot appears twice;
- the `skill` folder holds a file the source does not build, a Markdown file whose name starts
  with a dot included, since the build makes none. Other names that start with a dot, such as
  `.DS_Store`, are left alone. `--write` reports it and does not delete it;
- `proof.run` did not exit with 0. The error is on `proof.run` in `skillunit.yaml`, and says the
  command, how it ended and the last lines of its output, where the runner names the test that
  failed. When the run left no unit at all, it says that too, in the same error. A test that
  declares a unit and fails is reported twice: on its unit, with the assertion's message, and
  by the run;
- a line of the skill folder is not what the build gives. The message says to run
  `skillunit proof --write`, which is all a change to the code needs, and that the skill folder is
  built, so a change to its text is made where the line comes from.

A file whose build failed is neither compared nor written, so its one problem is reported once.

## Where a line comes from

Every finding about a line of the built skill says where that line comes from: the test file and
line of the unit, or the file and line of the source. Someone who edits `skill/` by hand is told
which file to edit instead.

```text
proof  ✗ skill/features/timeouts.md:42  this line is not what the build gives: the build has
         `Value: 5 seconds ('timeout: 5_000'), for every method.`, the skill has
         `Value: 10 seconds ('timeout: 10_000'), for every method.`. Run `skillunit proof --write`
         to update the skill. To change this text, change where it comes from: the skill folder
         is built.
         from the test of `default-timeout`, src/tinyfetch.test.ts:268
```

Lint and the model tests read the `skill` folder, and their findings carry the same origin. A
failed question names the file and line that declare it.

## Which tests `proof.run` runs

`skillunit proof`, `skillunit check` and `skillunit test` all need the records, so all three run
`proof.run`. It should run the files that declare units and nothing else. Measured on SkillUnit's
own skill at 0.3.0, where `proof.run` was the package's whole suite:

| What runs | Tests | Time |
| --- | --- | --- |
| the whole suite | 349 | 70.9 s |
| the 6 files that declare units | 129 | 4.0 s |

Name those files `*.skill.test.ts` and point `proof.run` at the name: `npx vitest run skill.test`.
A file name keeps the command current, since a new file of units is run as soon as it has the
name. On this repository, after the units moved to such files, `check --dry-run` on the own skill
went from 13.5 s to 1.5 s, and its `proof.run` from 12.8 s to 0.6 s.

The project's CI still runs the whole suite. A unit declared in a file the command does not run
is not lost without notice: its slot has no unit, and proof says so.

`--no-run` uses the records that are there, for a pipeline that ran the tests in an earlier step.

## Settings

```yaml
skill: ./skill          # built, committed, what agents read
source: ./skill-src     # written by people: prose, tables and slots
proof:
  run: "npx vitest run skill.test"      # the tests that declare units
  units: ./tmp/skill-units              # where tests leave units (the default)
  format: "npx --no-install prettier --write {file}"
```

Paths and globs start from the folder of `skillunit.yaml`, and the globs leave out
`node_modules`. Without `source` there is no proof layer and no questions: lint works on a skill
written by hand, and `check` says the proof is not configured.

`format` is for a project whose formatter rewrites Markdown, as Prettier rewrites tables and the
code in fenced blocks. Each built file is formatted on a copy next to where it goes, so the
formatter finds the project's settings, and the skill folder is compared with what it leaves.
The command runs once, with every copy in place of `{file}`, so it must take several files, as
`prettier --write` does. When that run fails, it runs once per file, and the error names the file
it failed on.

## The JSON contract

A test in another language declares a unit by writing the same file: one JSON object, under any
name that ends in `.json`, in the `proof.units` folder. `file` is the test file from the folder
of `skillunit.yaml`, and `line` the line of the declaration.

```json
{
  "skillunit": 2,
  "status": "passed",
  "id": "default-timeout",
  "kind": "fact",
  "file": "src/tinyfetch.test.ts",
  "line": 215,
  "test": "fact default-timeout: 10 seconds (`timeout: 10000`), for every method.",
  "when": "the user asks how long a request waits by default.",
  "value": "10 seconds (`timeout: 10000`), for every method.",
  "unknown": "tinyfetch has no separate connect timeout; say so instead of inventing one.",
  "values": { "seconds": 10 },
  "ask": [
    {
      "id": "default-timeout",
      "scenario": "The user asks how long a request waits when the code sets nothing.",
      "question": "What should the agent answer?",
      "options": { "right": "10 seconds", "longer": "30 seconds" },
      "expect": "right"
    }
  ],
  "examples": []
}
```

A failed test writes the same `skillunit`, `id`, `file`, `line` and `test`, with
`"status": "failed"` and the error's message in `error`. `examples` is a list of
`{ "lang": …, "text": … }`, the blocks of `examples` and of `u.example`. As with `unit()`, a value
is a single line and each `lang` is a fence language (letters, digits, `_`, `+`, `.` and `-`):
SkillUnit refuses a record that breaks either, since a line break there would add lines to the
built file that no unit declares. The finding about a record that is refused is on the record,
and its origin is the test the record names in `file` and `line`, when it has them. A unit
declared with no body has `"body": false`. `ask` holds
the questions as the spec gives them, one or a list, with or without `id`; SkillUnit fills in the
default ids and checks them when it reads the record. The other keys are those of the spec above.

A question about prose, declared with `ask()`, leaves a record of its own: `"kind": "question"`,
its id, the built file it is about in `skillFile`, from the skill folder and inside it, and itself
in `ask`.

```json
{
  "skillunit": 2,
  "status": "passed",
  "kind": "question",
  "id": "which-file-for-retries",
  "file": "src/tinyfetch.skill.test.ts",
  "line": 135,
  "test": "question which-file-for-retries: Which file of the skill should it read?",
  "skillFile": "SKILL.md",
  "ask": [{ "id": "which-file-for-retries", "scenario": "…", "question": "…", "options": { "retries": "features/retries.md", "errors": "features/errors.md" }, "expect": "retries" }]
}
```

In Python, a fixture in `conftest.py` can write it. SkillUnit ships no Python helper; this one is
a starting point:

```python
import hashlib, json, pathlib
import pytest

UNITS = pathlib.Path(__file__).parent / "tmp" / "skill-units"
# The file of the skill each test file declares last with `setup`, and the place of its next unit.
CURRENT = {}


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when == "call":
        item.skill_report = report


def write(request, record):
    UNITS.mkdir(parents=True, exist_ok=True)
    name = hashlib.sha1(request.node.nodeid.encode()).hexdigest()[:8]
    (UNITS / f"{record['id']}.{name}.json").write_text(json.dumps(record, indent=2))


@pytest.fixture
def setup(request):
    """Declares a file of the skill: the units of the tests after this one in the file belong to it."""

    def declare(id, file, **keys):
        path, line, _ = request.node.location
        CURRENT[path] = {"setup": id, "order": 0}
        write(request, {"skillunit": 2, "status": "passed", "kind": "file", "id": id, "file": path, "line": line + 1, "test": request.node.nodeid, "skillFile": file, **keys})

    return declare


@pytest.fixture
def unit(request):
    """Declares the unit this test proves; call it once, first, with the keys of the contract."""
    spec = {}

    def declare(id, **keys):
        if spec:
            raise RuntimeError(f"unit() is called once per test; {spec['id']} is already declared here")
        spec.update(id=id, **keys)

    yield declare
    report = getattr(request.node, "skill_report", None)
    if not spec or report is None or report.skipped:
        return
    file, line, _ = request.node.location
    record = {"skillunit": 2, "id": spec.pop("id"), "file": file, "line": line + 1, "test": request.node.nodeid}
    owner = CURRENT.get(file)
    if owner:
        record.update(setup=owner["setup"], order=owner["order"])
        owner["order"] += 1
    if report.passed:
        kind = "rule" if "do" in spec else "decision" if "paths" in spec else "fact"
        record.update(status="passed", kind=kind, examples=spec.pop("examples", []), **spec)
    else:
        crash = getattr(report.longrepr, "reprcrash", None)
        record.update(status="failed", error=crash.message if crash else str(report.longrepr))
    write(request, record)
```

```python
def test_timeouts(setup):
    # The file of the skill that the units of the tests below belong to.
    setup("timeouts", file="features/timeouts.md", title="tinyfetch — timeouts", when="Time out a request", description="Every request has a timeout.")


def test_default_timeout(unit):
    unit(
        "default-timeout",
        when="the user asks how long a request waits by default.",
        value=f"{DEFAULT_TIMEOUT} seconds, for every method.",
        values={"seconds": DEFAULT_TIMEOUT},
        ask={
            "scenario": "The user asks how long a request waits when the code sets nothing.",
            "question": "What should the agent answer?",
            "options": {"right": f"{DEFAULT_TIMEOUT} seconds", "longer": f"{3 * DEFAULT_TIMEOUT} seconds"},
            "expect": "right",
        },
    )
    assert client.get("/slow", wait=DEFAULT_TIMEOUT + 1).timed_out


def test_never_disable_timeout(unit):
    # A unit no test proves: the test only declares it.
    unit(
        "never-disable-timeout",
        body=False,
        when="a request may take long, such as an upload or a report.",
        do="raise `timeout` to fit the request, and never set it to `0`.",
    )
```

`request.node.location` gives the file from pytest's root folder, so this assumes `skillunit.yaml`
sits there. `setup` declares a file of the skill; the units of the tests after it in the same test file belong to it, in the order pytest runs them. A test calls `unit` once: a second call fails the test and says so. A failed test's
record keeps the assertion's message, as pytest reports it. A parametrized test writes one record
per case, all with the same id, and SkillUnit refuses an id declared twice; a unit built from
several cases goes in one test that loops over them. A region in Python reads `# #region skill:<id>` and `# #endregion`. The fixture copies
`ask` and `body` into the record as they are given, so SkillUnit checks the questions when it reads
the record, not when pytest runs the test.

## What it does not do

- A word that stands for a number, such as "doubled" or "half", passes the number rule, and so
  does a `values` entry typed by hand, `values: { times: 2 }`, where the code has the value under
  a name. Both are the rule of [no value typed twice](#no-value-typed-twice), which only a reader
  checks.
- Other words of a sentence that its body does not check can be false. `do: 'retry only GET'`
  passes with a body that asserts nothing about methods.
- The rule of assertions catches a body emptied by mistake: a body that makes no assertion and
  calls no `u.value()` fails its test, and one that only calls `u.example()` leaves a unit
  counted as declared, not proved. It does not catch `expect(true).toBe(true)`, which counts as
  an assertion. What catches it is a change to the code that makes the sentence false: when
  nothing goes red, the body proves nothing.
- The count of assertions comes from the runner. `skillunit/vitest` counts Vitest's `expect`; a
  helper made with `createUnit` and no `assertions`, and the pytest fixture above, count nothing,
  so a body there that asserts nothing still leaves its unit. A body that counts as asserting can
  still assert something other than what its sentence says.
- A body that builds its sentence from what it observes does not go red when the behaviour
  changes. `what-is-retried` above passes whatever is retried; the signal is the difference in
  the skill, which someone has to read in the pull request.
