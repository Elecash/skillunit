# Proof

The skill is built from the project's tests. Each file of the skill is declared with `setup()`,
each instruction with `unit()`, around the test that checks what it says. `skillunit proof`
runs those tests, builds the skill from what they declare, and compares the build with the skill
folder, which is committed.

```ts
import { unit } from 'skillunit/vitest';

unit(
  'default-timeout',
  {
    when: 'a request sets no `timeout`, and its client sets none.',
    value: `the request waits ${DEFAULT_TIMEOUT / 1000} seconds, whatever its method.`,
    values: { seconds: DEFAULT_TIMEOUT / 1000 },
  },
  async () => {
    // the test: its setup, what it does, its assertions
  },
);
```

The `Value` is built from `DEFAULT_TIMEOUT`. When someone changes the constant, the test still
passes, the built skill says 5 seconds, and `skillunit check` fails until the skill in the
repository says so too. The difference shows up in the same pull request as the change.

How to choose the units and what their bodies check is in the [style guide](style-guide.md).

## A file of the skill

`setup(id, spec)` declares a file of the skill. The units and questions after it in its test file
belong to that file, in the order they are declared.

```ts
import { setup } from 'skillunit/vitest';

setup('timeouts', {
  file: 'features/timeouts.md',
  title: 'tinyfetch — timeouts and cancelling',
  when: 'Time out or cancel a request',
  description: 'How long a request waits for the server, and how to stop it sooner.',
});
```

| Key | | Becomes |
| --- | --- | --- |
| `file` | required | the path of the Markdown file in the skill folder, inside it |
| `title` | required | `# <title>` |
| `description` | required | the line under the title |
| `when` | every file but `SKILL.md` | its row in the table of `SKILL.md`: the task that sends an agent to it |
| `frontmatter: { name, description }` | `SKILL.md` only | the frontmatter of the skill; `name` is kebab-case |

Each text is one line with no number, since a file has no `values`: a sentence that states a value
is a unit. `SKILL.md` gets a "Where to look" table with a row for every other file, from its
`when`. The region `skill:<setup id>`, anywhere in the test file, is the code under the
description, such as the import every example of the file assumes.

An example shows the import an agent writes, by the name of the package, so the test inside the
package imports the package by its name too. Node resolves a package's own name through the
`exports` of its `package.json`, and Vitest and TypeScript with `"moduleResolution": "NodeNext"`
do the same. tinyfetch's `exports` points at its source, so its tests run the code as it is, with
no build and no alias:

```json
{
  "name": "tinyfetch",
  "type": "module",
  "exports": "./src/index.ts"
}
```

```ts
// #region skill:timeouts
import { tf, TimeoutError } from 'tinyfetch';
// #endregion
```

A package whose `exports` points at built files resolves its own name to them, so its tests run
the last build. SkillUnit's own package is one: its tests map each entry to the source, with
`resolve.alias` in `vitest.config.ts` and `paths` in `tsconfig.json`:

```ts
// vitest.config.ts
resolve: { alias: { 'skillunit/vitest': fileURLToPath(new URL('./src/vitest.ts', import.meta.url)) } },
```

```json
{ "compilerOptions": { "paths": { "skillunit/vitest": ["./src/vitest.ts"] } } }
```

A unit with no `setup()` before it in its test file belongs to no file, and fails the build. A
build with files and no `SKILL.md` fails too.

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
| `values: { name: value }` | any kind | the numbers its text states, by name: text on one line, a finite number or a boolean. A name is letters, digits and hyphens |
| `ask` | any kind | the [questions](questions.md) for the decision model about the unit |

`do` makes a rule, `value` a fact, `decide` or `paths` a decision. [The kinds of unit](units.md) has each of them with an example. A spec with two of them, an id
that is not kebab-case, a key the kind does not take, an unknown key, or a question with a mistake
fails its test with a message that says what to fix. Ids of files and units share one space, and
each is declared once across the tests.

The body gets a context, and the runner's own context after it:

- `u.value(text)` sets the `Value` of a fact from what the body found going through a list of
  cases, such as which failures are retried. Any other fact has its sentence in `value`, and its
  body asserts what the sentence says;
- `u.example(lang, text)` adds a block the body produced: a command, a config, an output.

`and()`, `or()` and `code()`, from `skillunit/vitest` and `skillunit/unit` next to `key`, list
what the body read as a sentence does: `and(['a', 'b', 'c'])` is `a, b and c`, `or()` joins with
`or`, and `code()` puts each item in backticks, so `and(code(names))` lists names of the code as
code.

```ts
import { and, unit } from 'skillunit/vitest';

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
the regions of the test file each record names. The markers are comments in the test's language,
and the fence of the block takes the language of the test file. For a decision, the example of a
path is the region `skill:<id>.<path>`. A unit shows its regions first, in the order of the test
files, then the blocks of `u.example`, in the order of the calls. A rule's blocks go under
`Right`, a fact's under its `Value`. Each region id is in one place only.

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
with the id and the error's message, and throws again. A skipped test writes nothing. Each test
writes a failed record that says it did not finish before its body runs, and replaces it when the
body ends, so a test that times out, or a run that stops, leaves a unit whose test failed.

### What a body is counted as

`skillunit/vitest` counts the assertions of Vitest's `expect`, `expect.soft` included, and of
the `expect` of the test context when the body uses it, from the start of the body to its end:
an assertion in a `beforeEach` does not count.

| The body | The unit |
| --- | --- |
| makes an assertion, with or without `u.example()` | proved by a test |
| calls `u.value()`, with or without an assertion | proved by a test |
| calls `u.example()`, makes no assertion and calls no `u.value()` | built, and counted as declared: no test proves it |
| does none of the three | its test fails, and the unit is not built |

A body that does none of the three leaves a record that says so:

```text
unit `response-body`: the body made no assertion, so no test proves this unit. Assert in the body
what the unit says, or declare it with no body: `unit(id, spec)` is a unit no test proves
```

### Another runner

`skillunit/vitest` binds Vitest's `it`. For another runner, `skillunit/unit` exports
`createUnit(it, options)`, which gives `unit`, `ask` and `setup`. `options.write(record, key)`
replaces the function that writes the file, for a runner that cannot write files itself, such as
one in a browser. It is called twice for each test, with the same `key`: the second record
replaces the first. `options.remove(record, key)` takes out what `write` wrote for a test skipped
from inside its body; without it, that test keeps the record that says it did not finish.
`options.assertions(ctx)` returns how many assertions the test has made so far; with it, a body
is counted as the table above says. Without it nothing is counted, so a project
that asserts with `node:assert` under Vitest, which Vitest does not count, makes its own helper
with `createUnit(it)` and no `assertions`.

```ts
import { it } from 'node:test';
import { createUnit } from 'skillunit/unit';

export const { unit, ask, setup } = createUnit(it);
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

### Names from the code

A name a sentence gives in code comes from the code too, so a rename fails a test or changes the
skill:

- `key<T>(name)`, from `skillunit/vitest` or `skillunit/unit`, returns `name` and accepts only a
  key of `T`: `key<RequestOptions>('retry')`. A key renamed in the code fails the type-check of
  every test that still names it. With the type of a module, after
  `import type * as tinyfetch from 'tinyfetch'`, `key<typeof tinyfetch>('create')` accepts only a
  name the module exports, so a renamed export fails the same way.
- `exportNames(entry)`, from `skillunit/typescript`, gives the names a TypeScript file exports,
  `values` and `types` apart, as the compiler sees them. A class exported with `export type` is a
  type, and `export *` brings the names of its module. It takes a path or a `file:` URL, and
  resolves modules with the `tsconfig.json` above the file. It loads the project's own
  `typescript` when that package has the compiler API, and SkillUnit's own TypeScript 6 when it
  does not: TypeScript 7 exports only its version from `typescript`. `skillunit/vitest` and
  `skillunit/unit` never load it.

```ts
import { exportNames } from 'skillunit/typescript';

const { values, types } = exportNames(new URL('../index.ts', import.meta.url));
```

## A unit no test proves

Advice, and a claim about something outside the library, have nothing to assert. They are
declared with the same `unit()` and no body:

```ts
// A gap: how long a server may take is not in tinyfetch; `timeout-off` states what turning the
// timeout off does, and this advice stands on it.
unit('never-disable-timeout', {
  when: 'a request may take long, such as an upload or a report.',
  do: 'raise its `timeout` to a number of milliseconds that fits the request, and never set `timeout: 0`.',
  ask: {
    scenario: 'The user asks that an upload never time out, since it can take several minutes.',
    question: 'What should the agent set on that call?',
    options: { raise: '`timeout: 600_000`, ten minutes', off: '`timeout: 0`, so it never times out' },
    expect: 'raise',
  },
});
```

It still registers a test with the runner, so `skip`, `only` and a loop work as for any unit,
and its record says it has no body. A fact with no body gives its `value` in the spec. A unit with
no body shows no block, since only a body calls `u.example()`; a body that only calls
`u.example()` is how advice shows one, and its unit is counted as declared too.

The report never calls such a unit proved. Under each unit, proof shows
`proved by a test, src/skill/timeouts.test.ts:28` or `declared, no test, src/skill/timeouts.test.ts:199`,
and its summary counts both: `25 units · 23 proved by a test · 2 declared without one`.

## Building and checking

`skillunit proof`, and `skillunit check`:

1. empty the `proof.units` folder of its records;
2. run `proof.run` through the shell, from the folder of `skillunit.yaml`, and go on whatever it
   exits with, so a failing test is reported on the unit it declares;
3. read the records, build each file a `setup()` declares, and run `proof.format` once on the
   built Markdown files;
4. compare the result with the `skill` folder, and fail on each block of lines that differs.

`skillunit proof --write` writes the `skill` folder instead of comparing. `--no-run` skips steps
1 and 2 and uses the records that are there, for a pipeline that ran the tests in an earlier
step. Without `proof.run`, the records in the folder are used, as with `--no-run`.

It is an error when:

- a test that declares a unit failed. The finding is on the unit, with the message of its test;
- two tests declare the same id, or a file and a unit have the same id;
- a unit belongs to no `setup()`, or to one that left no record;
- no `setup()` declares `SKILL.md`;
- a region belongs to no unit and no file, or its id is in two places;
- a file the build gives is not in the skill folder;
- the skill folder has a unit that no test declares, because its test was skipped or deleted, or
  did not run. `--write` takes it out when the proof has no other error;
- the skill folder holds a Markdown file that no `setup()` declares. `--write` reports it and
  leaves it there;
- `proof.run` did not exit with 0. The error is on `proof.run` in `skillunit.yaml`, comes first in
  the report, and says the command, how it ended and the last 30 lines of its output, where the
  runner names the test that failed. A test that declares a unit and fails is reported twice: on
  its unit, with the assertion's message, and by the run. A run that left no record at all failed
  before the tests, as a type-check does: the error says so and shows the first 30 lines of the
  output instead, where the compiler prints its errors. It is then the only error, since nothing
  was built or compared, and `--write` writes nothing;
- a line of the skill folder is not what the build gives. The message says to run
  `skillunit proof --write`, which is all a change to the code needs, and that the skill folder is
  built, so a change to its text is made where the line comes from.

A file whose build failed is neither compared nor written, so its one problem is reported once.

### When a test fails

A test fails in one of three ways: an assertion fails, the test does not finish because it timed
out or the run stopped, or its file does not load. In all three `proof.run` does not exit with 0,
and its finding comes first. Then:

- a unit whose test failed, or did not finish, is reported on its unit with the message of its
  test and the line of the test. The file of the skill that holds it is not built, so `--write`
  leaves that file as it is;
- a unit, a file or a row of the index that the skill has and that the run left no record of, as
  when a test file does not load, is reported as such, with a pointer to the run. It is not called
  deleted, since its test may not have run.

`--write` takes a unit or a row of the index out of the skill only when the proof has no error,
and never removes a file. A run that exits with 0 is not enough: a `.only` left in a test file
makes the runner skip the other tests of that file, its `setup()` among them, and pass; the proof
then reports the unit of the `.only`, whose `setup()` left no record. While the proof has an error,
`--write` writes the files whose build takes nothing out, and says which files it left as they
are and why.

## Where a line comes from

Every finding about a line of the built skill says where that line comes from: the test file and
line of the unit, or of the `setup()` of its file. Someone who edits `skill/` by hand is told
which test to edit instead.

```text
proof  ✗ skill/features/timeouts.md:15  this line is not what the build gives: the build has
         `Value: the request waits 10 seconds ('timeout: 10_000'), whatever its method, then…`,
         the skill has `Value: the request waits 12 seconds ('timeout: 10_000'), whatever its…`.
         Run `skillunit proof --write` to update the skill. To change this text, change where it
         comes from: the skill folder is built.
         from the test of `default-timeout`, src/skill/timeouts.test.ts:28
```

The questions read the skill folder, and a failed question names the file and line that declare
it.

## Which tests `proof.run` runs

`skillunit proof`, `skillunit check` and `skillunit test` all need the records, so all three run
`proof.run`. It should run the files that declare the skill and nothing else: a test that fails
anywhere in the run fails the proof, and `--write` then takes nothing out of the skill. Measured
on SkillUnit's own package on 2026-11-27, on one machine, where Vitest runs the files in parallel:

| What runs | Tests | Time |
| --- | --- | --- |
| the whole suite | 331 | 4.2 s |
| the 5 files that declare the skill | 63 | 3.9 s |

Name those files `*.skill.test.ts` and point `proof.run` at the name: `npx vitest run skill.test`.
A file name keeps the command current, since a new file of units is run as soon as it has the
name.

### The type-check first

Vitest strips the types, so a test passes with a name the code no longer has, or with an example
that no longer compiles. In a round of trials with agents, four states of the code passed `check`
and failed only `tsc`. Put the type-check of the test files before them in `proof.run`, so that
the proof fails on them:

```yaml
proof:
  run: "npx tsc --noEmit && npx vitest run skill.test"
```

The `tsconfig.json` must include the test files. A type error is then one finding, on
`proof.run`, with the compiler's errors, and nothing is built, compared or written until the tests
type-check. `skillunit init` suggests this command when the folder has a `tsconfig.json`.

What it adds to `check --dry-run`, measured on 2026-11-27 on one machine:

| Skill | Without the type-check | With it | The type-check alone |
| --- | --- | --- | --- |
| tinyfetch | 0.96 s | 1.25 s | 0.35 s |
| SkillUnit's own | 4.05 s | 4.75 s | 0.76 s |

The project's CI still runs the whole suite. A unit declared in a file the command does not run
is not lost without notice: the skill folder has it and no test declares it, and proof says so.

## Settings

```yaml
skill: ./skill          # built, committed, what agents read
proof:
  run: "npx tsc --noEmit && npx vitest run skill.test"   # the type-check, then the tests that declare the skill
  units: ./tmp/skill-units              # where tests leave their records (the default)
  format: "npx --no-install prettier --write {file}"
```

Paths start from the folder of `skillunit.yaml`. `proof`, `test` and `check` exit with 2 on
settings with no `proof`: the skill and its questions both come from the records of `proof.run`.

`format` is for a project whose formatter rewrites Markdown, as Prettier rewrites tables and the
code in fenced blocks. Each built file is formatted on a copy next to where it goes, so the
formatter finds the project's settings, and the skill folder is compared with what it leaves.
The command runs once, with every copy in place of `{file}`, so it must take several files, as
`prettier --write` does. When that run fails, it runs once per file, and the error names the file
it failed on.

## The JSON contract

A test in another language declares the skill by writing the same files: one JSON object each,
under any name that ends in `.json`, in the `proof.units` folder. `file` is the test file from the
folder of `skillunit.yaml`, and `line` the line of the declaration. The contract is at version 2.

A file of the skill, declared with `setup()`:

```json
{
  "skillunit": 2,
  "status": "passed",
  "kind": "file",
  "id": "timeouts",
  "file": "src/skill/timeouts.test.ts",
  "line": 17,
  "test": "file timeouts: tinyfetch — timeouts and cancelling",
  "skillFile": "features/timeouts.md",
  "title": "tinyfetch — timeouts and cancelling",
  "description": "How long a request waits for the server, and how to stop it sooner.",
  "when": "Time out or cancel a request"
}
```

A unit, with the id of the `setup()` it belongs to in `setup` and its place among the units of
that file, from 0, in `order`:

```json
{
  "skillunit": 2,
  "status": "passed",
  "id": "default-timeout",
  "kind": "fact",
  "file": "src/skill/timeouts.test.ts",
  "line": 28,
  "test": "fact default-timeout: the request waits 10 seconds (`timeout: 10_000`), whatever its method, …",
  "setup": "timeouts",
  "order": 0,
  "when": "a request sets no `timeout`, and its client sets none.",
  "value": "the request waits 10 seconds (`timeout: 10_000`), whatever its method, then rejects with a `TimeoutError` whose `timeout` is that number of milliseconds.",
  "values": { "seconds": 10, "ms": "10_000" },
  "examples": []
}
```

A failed test writes the same `skillunit`, `id`, `file`, `line` and `test`, with
`"status": "failed"` and the error's message in `error`, and the unit's `ask` when it has
questions, which the report then counts as left out. A helper in another language does what
`unit()` does: it writes a failed record that says the test did not finish when the test starts,
replaces it when the test ends, and takes it out when the test is skipped from inside, so a test
that times out is reported as failed and not as deleted. `examples` is a list of
`{ "lang": …, "text": … }`, the blocks of `u.example`. As with `unit()`, each entry of `values` is
a single line and each `lang` is a fence language (letters, digits, `_`, `+`, `.` and `-`):
SkillUnit refuses a record that breaks either, since a line break there would add lines to the
built file that no unit declares. A label such as `when` or `value` is one paragraph: its line
breaks become spaces, and a blank line in it is refused. The finding about a record that is refused is on the record, and its origin is the test
the record names in `file` and `line`, when it has them. A unit no test proves has
`"body": false`. `ask` holds the questions as the spec gives them, one or a list, with or without
`id`; SkillUnit fills in the default ids and checks them when it reads the record. The other keys
are those of the spec above.

A question about prose, declared with `ask()`, leaves a record of its own: `"kind": "question"`,
its id, the built file it is about in `skillFile`, from the skill folder and inside it, and itself
in `ask`.

```json
{
  "skillunit": 2,
  "status": "passed",
  "kind": "question",
  "id": "which-file-for-retries",
  "file": "src/skill/index.test.ts",
  "line": 35,
  "test": "question which-file-for-retries: Which file of the skill should it read?",
  "skillFile": "SKILL.md",
  "setup": "tinyfetch",
  "ask": [{ "id": "which-file-for-retries", "scenario": "…", "question": "…", "options": { "retries": "features/retries.md", "errors": "features/errors.md" }, "expect": "retries" }]
}
```

In Python, a fixture in `conftest.py` can write them. SkillUnit ships no Python helper; this one
is a starting point:

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


def path(request, id):
    return UNITS / f"{id}.{hashlib.sha1(request.node.nodeid.encode()).hexdigest()[:8]}.json"


def write(request, record):
    UNITS.mkdir(parents=True, exist_ok=True)
    path(request, record["id"]).write_text(json.dumps(record, indent=2))


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
    file, line, _ = request.node.location
    record = {"skillunit": 2, "file": file, "line": line + 1, "test": request.node.nodeid}

    def declare(id, **keys):
        if spec:
            raise RuntimeError(f"unit() is called once per test; {spec['id']} is already declared here")
        spec.update(id=id, **keys)
        record["id"] = id
        owner = CURRENT.get(file)
        if owner:
            record.update(setup=owner["setup"], order=owner["order"])
            owner["order"] += 1
        # Replaced when the test ends: a test that does not finish keeps this record.
        write(request, {**record, "status": "failed", "error": "the test did not finish, because it timed out or the run stopped before it ended"})

    yield declare
    if not spec:
        return
    spec.pop("id")
    report = getattr(request.node, "skill_report", None)
    if report is None or report.skipped:
        path(request, record["id"]).unlink(missing_ok=True)
        return
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
sits there. `setup` declares a file of the skill; the units of the tests after it in the same test file belong to it, in the order pytest runs them. A test calls `unit` once: a second call fails the test and says so. `unit` writes a failed record that says the test did not finish when it is called, so a test that hangs or a run that stops leaves it; when the test ends, the record of how it ended replaces it, and a skipped test takes it out. A failed test's
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
- SkillUnit builds the skill from the tests, so the skill is as right as the tests are. An
  assertion edited to match a change, with the sentence above it left as it was, leaves a false
  sentence, and nothing reports it. When a test goes red, fix the code; when the change is meant,
  change the sentence and the body together.
- A body that goes through a list of cases and writes which did what, as `what-is-retried` above
  does, passes whatever each case does: a change shows only in the built line. Keep that form for
  a list, and assert everything else.
