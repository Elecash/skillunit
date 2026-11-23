# Proof

Lint checks that the examples of a skill compile, and does not read what a sentence says. A
skill can pass it and still say the default delay is 300 ms after the code changed it to 500. Proof closes that gap with the project's own tests: a
test that asserts what a unit says carries the unit's id in its title, and when it fails,
`skillunit proof` names the unit. A test can also produce the unit's example, which SkillUnit
copies into the skill, so the example is code that ran.

SkillUnit never runs the tests. It reads what a test run left behind: its JUnit XML report, the
examples the tests wrote, and the regions of the test files. `skillunit.lock` remembers which
units were proved, so a unit whose test is deleted or skipped fails instead of going quiet.

## The three states of a unit

- **Proved**: a test whose title carries `[skill:<unit id>]` passed, and no test tagged for the
  unit failed.
- **Failed**: a test tagged for the unit failed; or [the lock](#the-lock) lists the unit and no
  tagged test passed, because its test was deleted, skipped or lost its tag.
- **Unproved**: the lock does not list it, and no test is tagged for it. Advice ("raise the
  timeout of an upload") and claims about what the library cannot see (what a server does with a
  repeated POST) stay unproved. The report counts them, and the skill says nothing about proof.

## The tag

A test proves the unit `<id>` when its full title contains `[skill:<id>]`: the name of the test,
and the class, file or suite the runner writes next to it. A title may carry several tags.

```ts
it('does not retry by default, and waits 300 ms [skill:retry-defaults]', async () => {
  // …
});
```

A `fact` has no example, so the tag alone proves it. The test should assert the value the unit
states, and read it from the library where it can.

A placeholder such as `[skill:<id>]` in a title is not a tag: an id is letters, digits, `-`, `_`
and `.`.

## The example

A block of a unit flagged `proof=<id>` after its language holds an example a test produced.
`<id>` is the unit's id, or the id, a dot and a name when the unit has several such blocks
(`proof=pick-a-client.shared`). The flag works on any block of the unit, a block inside a
`Decide` path included.

````md
Right:

```ts proof=check-with-is-http-error
try {
  await tf.get("https://api.example.com/users/1");
} catch (error) {
  if (isHttpError(error) && error.status === 404) console.log("no such user");
  else throw error;
}
```
````

The text comes from one of two places, never both.

**A region of a test file**, for an example that is code. The lines between a line containing
`#region skill:<id>` and the next line containing `#endregion` go into the block, with the
indentation they share removed. The markers are comments in the test's language.

```ts
it('lets the caller tell a 404 apart [skill:check-with-is-http-error]', async () => {
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
});
```

**A file the test wrote**, for an example that is a value: a JSON definition, a config, an
output. The test writes `<examples>/<id>.<any extension>`, and its text goes into the block as
it is, without the newline at its end. In JavaScript and TypeScript:

```ts
import { skillExample } from 'skillunit/proof';

skillExample('client-config', { baseUrl: 'https://api.example.com/v1/' });
```

`skillExample(id, value)` writes a string as it is to `<id>.txt`, and any other value as JSON
with two-space indentation to `<id>.json`, in the `proof.examples` folder of the nearest
`skillunit.yaml` above the working directory. It is an ES module; a Jest project that runs as
CommonJS cannot import it and writes the file itself, as tests in other languages do.

`skillunit proof --write` copies every example into its block, keeping the block's indentation
and its info string, and touches nothing else in the file. `skillunit proof` alone compares in
memory and fails on a block that differs, so it needs no git and works before a commit.

## The lock

A tag says which units are proved today. It cannot say which were proved yesterday: when a test
goes, its tag goes with it. `skillunit.lock`, next to `skillunit.yaml`, lists the ids of the
proved units, and is committed with the skill.

```json
{
  "version": 2,
  "proved": [
    "check-with-is-http-error",
    "retry-defaults"
  ]
}
```

`skillunit proof --write` updates it after rewriting the blocks:

- it adds every unit a test proves that the lock does not list yet;
- it drops the ids no unit of the skill has any more, because the unit was deleted or renamed;
- it never drops a unit that is still in the skill. A proof that is lost shows up as a line
  someone removed on purpose, in the diff of the change that lost it.

It says what it did, as `Updated skillunit.lock: added 2 units (a, b), dropped 1 (c).`, and
writes nothing when nothing changed. After tagging a test, run the tests and
`skillunit proof --write`, and commit the lock with the test.

**To stop proving a unit**, take the tag off its test, or delete the test, then run
`skillunit proof --forget <id>`. It takes several ids separated by commas, or the option more than
once. It removes all of them or none: an id the lock does not list is an error, and nothing is
written. It does not go with `--write`, which would add back a unit a test still proves. A
forgotten unit that a test still proves fails the check that follows. Removing the line from
`skillunit.lock` by hand does the same.

The report has to come from the whole test run. A unit the lock lists and that a partial run did
not reach fails as if its test were gone.

## Settings

```yaml
proof:
  reports: ./reports/junit.xml         # the JUnit XML of the test run: a glob or a list of them
  examples: ./tmp/skill-proof          # where tests write examples (the default)
  sources: ["src/**/*.test.ts"]        # test files with regions; leave it out if there are none
  format: "npx --no-install prettier --write {file}"   # run on a skill file after writing it
```

Paths and globs start from the folder of `skillunit.yaml`, and the globs leave out
`node_modules`. Without a `proof` key, `check` skips the layer and says so.

`format` is for a project whose formatter rewrites the skill's Markdown, as Prettier rewrites the
code in its blocks. `--write` runs the command on each file it changed, and the check compares
the blocks of a formatted copy of the file, so the formatter and SkillUnit agree on the text.
The copy sits next to the file for the time of the command, so the formatter finds the
project's settings.

## What it reports

`skillunit proof` fails when:

- no report matches `proof.reports`;
- a test tagged for a unit failed;
- the lock lists a unit that no tagged test proves: every tagged test was skipped, or no test is
  tagged for it. The message says which, and the two ways out: bring the test back, or
  `skillunit proof --forget <id>` when the unit is no longer meant to be proved;
- a test proves a unit that the lock does not list, or there is no lock and a test proves a unit.
  The message says to run `skillunit proof --write`;
- the lock lists an id that no unit of the skill has;
- the lock cannot be read: broken JSON, merge conflict markers, or a version
  this SkillUnit does not know;
- every test tagged for a unit was skipped, or no test is tagged for it, and the unit has a
  flagged block;
- a tag names no unit of the skill;
- a flagged block names another unit than its own;
- a flagged block has no file and no region, or has both;
- a flagged block differs from what its file or region gives. The message shows the first line
  that differs, and says to run `skillunit proof --write`.

It warns about a unit the lock does not list whose tagged tests were all skipped, about an
example file or a region that no block uses, and about an example file older than the test run
in the reports, which a test did not write this time.

Every reporter shows the units proved, failed and unproved, the blocks that come from tests, and
what `--write` or `--forget` did to the lock. `skillunit check` runs the layer after lint,
`--dry-run` included: it needs no key.

## Wiring a test run

Run the tests with a JUnit reporter before `check`, and empty the examples folder first, so a
file left from an earlier run does not pass for this one.

**Vitest.** In `vitest.config.ts`:

```ts
import { rmSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

rmSync(new URL('./tmp/skill-proof', import.meta.url), { recursive: true, force: true });

export default defineConfig({
  test: {
    reporters: ['default', 'junit'],
    outputFile: { junit: './reports/junit.xml' },
  },
});
```

**Jest**, with the [jest-junit](https://www.npmjs.com/package/jest-junit) reporter. Jest-junit
writes the describe blocks into `classname`, which is part of the title SkillUnit reads:

```sh
JEST_JUNIT_OUTPUT_DIR=reports JEST_JUNIT_OUTPUT_NAME=junit.xml npx jest --ci --reporters=default --reporters=jest-junit
```

**pytest**. A Python test name cannot hold `[skill:<id>]`; a `parametrize` id can, and pytest
writes it in brackets after the name:

```python
@pytest.mark.parametrize("_skill", [None], ids=["skill:retry-defaults"])
def test_retry_defaults(_skill):
    assert DEFAULT_RETRY_DELAY == 300
```

```sh
pytest --junitxml=reports/junit.xml
```

A region in Python reads `# #region skill:<id>` and `# #endregion`.

In CI, the step that runs the tests comes before `skillunit check`; see [CI](ci.md).

## What it does not do

- It does not check that a sentence says no more than its test asserts. A unit that claims two
  things and a test that asserts one pass together.
- It does not write a value into a sentence. When the test of a `fact` fails, someone corrects
  the `Value` by hand.
- It does not know whether the examples folder was emptied before the run. It warns about a file
  older than the run, and only when the report says when the run started.
