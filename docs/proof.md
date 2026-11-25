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
| `values: { name: value }` | any kind | values the prose of the skill uses, as `{{value:<id>.<name>}}` |

`do` makes a rule, `value` a fact, `decide` or `paths` a decision. A spec with two of them, an id
that is not kebab-case, or a key the kind does not take fails its test with a message that says
what to fix.

The body gets a context, and the runner's own context after it:

- `u.value(text)` sets the `Value` of a fact from what the body observed;
- `u.example(lang, text)` adds a block the body produced: an output, a config, a table of
  outcomes.

```ts
unit('what-is-retried', { when: 'a request with `retry` fails.' }, async (u) => {
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
the next line containing `#endregion`, with the indentation they share removed. The markers are
comments in the test's language. For a decision, the example of a path is the region
`skill:<id>.<path>`. A unit shows its regions first, in the order of the test files, then the
blocks of `u.example`, in the order of the calls. A rule's blocks go under `Right`, a fact's
under its `Value`.

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

`skillunit/vitest` binds Vitest's `it`. For another runner, `skillunit/unit` exports
`createUnit(it, options)`: `options.write(record, key)` replaces the function that writes the
file, for a runner that cannot write files itself, such as one in a browser.

```ts
import { it } from 'node:test';
import { createUnit } from 'skillunit/unit';

export const unit = createUnit(it);
```

## The source and its slots

`source` in `skillunit.yaml` is the folder people write. `skill` is the folder agents read, and
`skillunit proof --write` builds it. Both are committed.

The source has the same files as the skill. In a Markdown file:

- `{{unit:<id>}}`, alone on a line, is where the unit of a test goes;
- `{{value:<id>.<name>}}`, anywhere, a fenced block included, is a value of a unit;
- a unit written by hand, such as advice no test can prove, is written as in any skill.

````md
## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `timeout` | number (ms) | `{{value:default-timeout.ms}}` | abort the request after this long |

## Rules

{{unit:default-timeout}}

### rule: never-disable-timeout

When: a request may take long, such as an upload or a report.

Do: raise `timeout` to a number of milliseconds that fits the request, and never set it to `0`.
````

Every other file is copied as it is. The prefixes `unit:` and `value:` are there so that a skill
about a template language can show `{{ user.name }}`.

## Building and checking

`skillunit proof`, and `skillunit check`:

1. empty the `proof.units` folder of its records;
2. run `proof.run` through the shell, from the folder of `skillunit.yaml`, and go on whatever it
   exits with, so a failing test is reported on the unit it declares;
3. read the units, fill the source, and run `proof.format` on each built Markdown file;
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
- two tests declare the same id, or a test and a unit written by hand do;
- a slot appears twice;
- the `skill` folder holds a file the source does not build. `--write` reports it and does not
  delete it;
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
         `Value: 5 seconds ('timeout: 5000'), for every method.`, the skill has
         `Value: 10 seconds ('timeout: 10000'), for every method.`. Run `skillunit proof --write`
         to update the skill. To change this text, change where it comes from: the skill folder
         is built.
         from the test of `default-timeout`, src/tinyfetch.test.ts:215
```

Lint and the model tests read the `skill` folder, and their findings carry the same origin. A
failed model test about a unit that comes from a test names that test.

## Settings

```yaml
skill: ./skill          # built, committed, what agents read
source: ./skill-src     # written by hand
proof:
  run: "npx vitest run"                 # the project's tests
  units: ./tmp/skill-units              # where tests leave units (the default)
  sources: ["src/**/*.test.ts"]         # test files to read regions from
  format: "npx --no-install prettier --write {file}"
```

Paths and globs start from the folder of `skillunit.yaml`, and the globs leave out
`node_modules`. Without `source` there is no proof layer: lint and the model tests work on a
skill written by hand, and `check` says the layer is not configured.

`format` is for a project whose formatter rewrites Markdown, as Prettier rewrites tables and the
code in fenced blocks. Each built file is formatted on a copy next to where it goes, so the
formatter finds the project's settings, and the skill folder is compared with what it leaves.

## The JSON contract

A test in another language declares a unit by writing the same file: one JSON object, under any
name that ends in `.json`, in the `proof.units` folder. `file` is the test file from the folder
of `skillunit.yaml`, and `line` the line of the declaration.

```json
{
  "skillunit": 1,
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
  "examples": []
}
```

A failed test writes the same `skillunit`, `id`, `file`, `line` and `test`, with
`"status": "failed"` and the error's message in `error`. `examples` is a list of
`{ "lang": …, "text": … }`. The other keys are those of the spec above.

In Python, a fixture in `conftest.py` can write it. SkillUnit ships no Python helper; this one is
a starting point:

```python
import hashlib, json, pathlib
import pytest

UNITS = pathlib.Path(__file__).parent / "tmp" / "skill-units"


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    if report.when == "call":
        item.skill_report = report


@pytest.fixture
def unit(request):
    """Declares the unit this test proves; call it first, with the keys of the contract."""
    spec = {}
    yield lambda id, **keys: spec.update(id=id, **keys)
    report = getattr(request.node, "skill_report", None)
    if not spec or report is None or report.skipped:
        return
    file, line, _ = request.node.location
    record = {"skillunit": 1, "id": spec.pop("id"), "file": file, "line": line + 1, "test": request.node.nodeid}
    if report.passed:
        kind = "rule" if "do" in spec else "decision" if "paths" in spec else "fact"
        record.update(status="passed", kind=kind, examples=spec.pop("examples", []), **spec)
    else:
        record.update(status="failed", error=str(report.longrepr).splitlines()[-1])
    UNITS.mkdir(parents=True, exist_ok=True)
    name = hashlib.sha1(request.node.nodeid.encode()).hexdigest()[:8]
    (UNITS / f"{record['id']}.{name}.json").write_text(json.dumps(record, indent=2))
```

```python
def test_default_timeout(unit):
    unit(
        "default-timeout",
        when="the user asks how long a request waits by default.",
        value=f"{DEFAULT_TIMEOUT} seconds, for every method.",
        values={"seconds": DEFAULT_TIMEOUT},
    )
    assert client.get("/slow", wait=DEFAULT_TIMEOUT + 1).timed_out
```

`request.node.location` gives the file from pytest's root folder, so this assumes `skillunit.yaml`
sits there. A region in Python reads `# #region skill:<id>` and `# #endregion`.

## What it does not do

- A literal in a description that its body does not check can be false. `do: 'retry only GET'`
  passes with a body that asserts nothing about methods. Build the sentence from the code where
  the code has the value, and assert the rest.
- A body that asserts nothing still leaves its unit. Proof knows the test ran and passed, and
  not what it checked.
- A body that builds its sentence from what it observes does not go red when the behaviour
  changes. `what-is-retried` above passes whatever is retried; the signal is the difference in
  the skill, which someone has to read in the pull request.
